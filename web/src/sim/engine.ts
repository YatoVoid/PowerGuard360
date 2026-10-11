import type {
  Board, Engineer, Features, GasMetering, HistoryPoint, MaintenanceRequest, PlantEvent, PlantState, Prediction, Priority, Recommendation, RemotePrediction, Severity, StepInputs, Turbine,
} from "../types";
import { CONTROL_ROOM, assetLabel, pathLength, pointOnPath, routeFrom } from "./site";
import {
  FAILURE_ACTION, FAILURE_NAME, WINDOWS,
  failureProbability, rowFeatures, shaftPowerW,
} from "./model";

// Machine readings come from the AI4I 2020 dataset (see data/README.md). Only power demand and turbine
// output are modelled, because the dataset has no power-plant load.

export const RATED_MW = 335;
export const TURBINE_COUNT = 8;
// One dataset row is replayed per unit every few seconds.
export const ROW_SECONDS = 8;
const HISTORY_LEN = 300;
const RISK_HISTORY_LEN = 180;
const EVENT_LEN = 60;
// Wi-Fi on a small board drops a post now and then; only call it offline after a real silence.
const SENSOR_STALE_MS = 15000;
// The ML laptop's forecast replaces the tree's for its unit while it keeps posting.
export const REMOTE_STALE_MS = 15000;
export const WATCH_RISK = 0.5;

// The sensor board on the table feeds GT-08; every other unit replays the dataset.
export const LIVE_SENSOR_UNIT = "GT-08";
// Walking pace on site, replayed faster for the demo.
export const WALK_M_PER_S = 1.3;
export const SITE_REPLAY_SPEED = 5;
export const REPAIR_S = 25;
const SIM_ACCEPT_S = 4;
// After a fix, give the readings time to settle before the model can recommend the unit again.
const FIX_COOLDOWN_S = 120;
// After the manager declines, the same unit stays quiet this long.
const DECLINE_QUIET_S = 180;
const RECOMMENDATION_LEN = 40;
const PRIORITY_FOR: Record<Recommendation["alertLevel"], Priority> = { Critical: "P1", Alert: "P2", Watch: "P3", Normal: "P3" };
const GENERAL_ACTION = "Run a general inspection. The model flags failure risk but no specific failure mode.";

export const PHONE_ENGINEER = "ENG-1";
function initialEngineers(): Engineer[] {
  return [
    { id: PHONE_ENGINEER, name: "Phone engineer", kind: "phone", status: "available", requestId: null, pos: CONTROL_ROOM, autoWalk: false, lastStepT: null },
    { id: "ENG-2", name: "Wali", kind: "sim", status: "available", requestId: null, pos: CONTROL_ROOM, autoWalk: false, lastStepT: null },
    { id: "ENG-3", name: "Sakina", kind: "sim", status: "available", requestId: null, pos: CONTROL_ROOM, autoWalk: false, lastStepT: null },
    { id: "ENG-4", name: "Anthony", kind: "sim", status: "available", requestId: null, pos: CONTROL_ROOM, autoWalk: false, lastStepT: null },
    { id: "ENG-5", name: "Chris", kind: "sim", status: "available", requestId: null, pos: CONTROL_ROOM, autoWalk: false, lastStepT: null },
  ];
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180, la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Gas turbines lose roughly 0.6% of output per degree of inlet air above 15 °C.
export function derateFactor(airTempK: number) {
  return Math.max(0.6, Math.min(1.05, 1 - 0.006 * (airTempK - 273.15 - 15)));
}

function demandAt(t: number, rnd: () => number) {
  const slow = 2050 + 140 * Math.sin((2 * Math.PI * t) / 900);
  // AI training jobs pull power in synchronized bursts.
  const inBurst = t % 90 < 32;
  const burst = inBurst ? 170 : 0;
  return slow + burst + (rnd() - 0.5) * 24;
}

const unitIndex = (tb: Turbine) => Number(tb.id.slice(3)) - 1;

// Where each unit starts in its tool life, staggered so units don't all reach end of life together.
// GT-03 starts close enough to its recorded overstrain failure for the forecast to matter early in a demo.
function startRow(i: number) {
  const [start, end] = WINDOWS[i];
  if (i === 2) return Math.max(start, end - 1 - 48);
  return start + Math.floor(((i * 17) % 40) / 100 * (end - start));
}

function fitNewTool(tb: Turbine) {
  tb.row = WINDOWS[unitIndex(tb)][0];
  tb.features = rowFeatures(tb.row);
}

function makeTurbine(i: number): Turbine {
  const row = startRow(i);
  const features = rowFeatures(row);
  return {
    id: `GT-${String(i + 1).padStart(2, "0")}`,
    status: "running",
    tripCause: null,
    outputMw: 260,
    capacityMw: RATED_MW,
    ratedMw: RATED_MW,
    features,
    shaftPowerKw: shaftPowerW(features) / 1000,
    source: "sim",
    row,
    measured: [],
  };
}

// The decision tree's verdict on the current reading. It stands in only while the ML service is unreachable.
export function forecast(id: string, f: Features): Prediction {
  const probability = failureProbability(f);
  return {
    turbineId: id,
    probability,
    mode: null,
    minutesToFailure: null,
    risk: Math.round(probability * 100) / 100,
    detail: `Decision tree gives ${Math.round(probability * 100)}% failure probability on the current reading`,
    by: "Decision tree",
  };
}

// The machine_learning service: its diagnosis when Model 1 flags a failure, otherwise just its risk.
// Nothing here projects a failure time; the models judge the current reading only.
function fromService(r: RemotePrediction & { ml: NonNullable<RemotePrediction["ml"]> }): Prediction {
  const by = r.model || "Random Forest";
  if (r.ml.failureClass === 1) return { ...fromRemote(r), by, ml: r.ml };
  return {
    turbineId: r.unit,
    probability: r.probability,
    mode: null,
    minutesToFailure: null,
    risk: Math.round(r.probability * 100) / 100,
    detail: r.detail ?? `${by} gives ${Math.round(r.probability * 100)}% failure risk on the current reading`,
    by,
    ml: r.ml,
  };
}

function fromRemote(r: RemotePrediction): Prediction {
  const minutes = r.minutes_to_failure ?? null;
  const by = r.model || "ML laptop";
  const when = minutes === null ? "" : ` in about ${fmtMin(minutes)}`;
  return {
    turbineId: r.unit,
    probability: r.probability,
    mode: r.mode ?? null,
    minutesToFailure: minutes,
    risk: Math.round(r.probability * 100) / 100,
    detail: r.detail || (r.mode ? `${by} forecasts ${FAILURE_NAME[r.mode].toLowerCase()}${when}` : `${by} gives ${Math.round(r.probability * 100)}% failure probability${when}`),
    by,
  };
}

function fmtMin(min: number) {
  return min < 1 ? `${Math.max(1, Math.round(min * 60))} s` : `${min.toFixed(1)} min`;
}

// Air quality at the gas metering skid. The first readings after the sensor connects set the clean-air
// level; it then follows the air down quickly and up only slowly, so a leak can't teach it that gas is normal.
export const GAS_REDUCED_PCT = 85;
export const GAS_ALERT_PCT = 70;
export const GAS_WARMUP_SAMPLES = 6;
export const GAS_LEAK_CHECK = "Check the gas metering skid for leaks with a handheld detector: flanges, valve packings, meter seals and the pipeline inlet.";

function applyGas(prev: GasMetering, inputs: StepInputs): GasMetering {
  const now = inputs.nowMs ?? 0;
  const raw = inputs.sensor?.readings.air_quality_raw;
  const fresh = (at: number | null) => at !== null && now - at < SENSOR_STALE_MS;
  if (raw === undefined || inputs.sensorAtMs === undefined) {
    const connected = fresh(prev.lastSeenMs);
    return { ...prev, connected, history: [...prev.history, connected ? prev.qualityPct ?? 100 : NaN].slice(-RISK_HISTORY_LEN) };
  }
  // A sensor coming back after a gap may have been moved or replaced, so it learns clean air again.
  const restart = !fresh(prev.lastSeenMs);
  const samples = restart ? 1 : prev.samples + 1;
  const base = restart || prev.baseline === null ? raw
    : samples <= GAS_WARMUP_SAMPLES ? prev.baseline + (raw - prev.baseline) / samples
    : raw < prev.baseline ? prev.baseline + (raw - prev.baseline) * 0.2
    : raw < prev.baseline * 1.1 ? prev.baseline + (raw - prev.baseline) * 0.02
    : prev.baseline;
  const qualityPct = Math.max(0, Math.min(100, Math.round((100 * base) / Math.max(raw, 1))));
  const level = samples <= GAS_WARMUP_SAMPLES ? "good" : qualityPct < GAS_ALERT_PCT ? "poor" : qualityPct < GAS_REDUCED_PCT ? "reduced" : "good";
  return {
    connected: true, lastSeenMs: inputs.sensorAtMs, raw, baseline: base, samples,
    qualityPct: samples <= GAS_WARMUP_SAMPLES ? 100 : qualityPct, level,
    history: [...prev.history, samples <= GAS_WARMUP_SAMPLES ? 100 : qualityPct].slice(-RISK_HISTORY_LEN),
  };
}

function applyBoard(prev: Board, inputs: StepInputs): Board {
  const now = inputs.nowMs ?? 0;
  const r = inputs.sensor?.readings;
  if (r && inputs.sensorAtMs !== undefined) {
    const sent: Partial<Features> = {
      type: r.type ?? prev.features?.type,
      airTempK: r.air_temp_k, processTempK: r.process_temp_k, rpm: r.rpm, torqueNm: r.torque_nm, toolWearMin: r.tool_wear_min,
    };
    const features = Object.fromEntries(Object.entries(sent).filter(([, v]) => v !== undefined)) as Partial<Features>;
    const any = Object.keys(features).some((k) => k !== "type");
    return { features: any ? features : null, lastSeenMs: inputs.sensorAtMs, source: any && now - inputs.sensorAtMs < SENSOR_STALE_MS ? "live" : "sim" };
  }
  return { ...prev, source: prev.features && prev.lastSeenMs !== null && now - prev.lastSeenMs < SENSOR_STALE_MS ? "live" : "sim" };
}

export function createPlant(seed = 7): PlantState {
  const turbines = Array.from({ length: TURBINE_COUNT }, (_, i) => makeTurbine(i));
  return {
    t: 0,
    seed,
    demandMw: 2050,
    outputMw: 0,
    gridMw: 0,
    reserveMw: 0,
    turbines,
    battery: { socPct: 82, powerMw: 0, capacityMwh: 800, maxPowerMw: 400 },
    board: { source: "sim", lastSeenMs: null, features: null },
    gas: { connected: false, lastSeenMs: null, raw: null, baseline: null, samples: 0, qualityPct: null, level: null, history: [] },
    engineers: initialEngineers(),
    requests: [],
    recommendations: [],
    predictions: [],
    events: [{ id: 0, t: 0, severity: "info", asset: LIVE_SENSOR_UNIT, text: `${LIVE_SENSOR_UNIT} reads the sensor board when it is connected` }],
    history: [],
    riskHistory: Object.fromEntries(turbines.map((tb) => [tb.id, []])),
  };
}

export function step(prev: PlantState, inputs: StepInputs = {}): PlantState {
  const t = prev.t + 1;
  const rnd = mulberry32(prev.seed * 100003 + t);
  const events: PlantEvent[] = [];
  let nextEventId = (prev.events[0]?.id ?? 0) + 1;
  const log = (severity: Severity, asset: string, text: string) => events.push({ id: nextEventId++, t, severity, asset, text });

  const board = applyBoard(prev.board, inputs);
  const gas = applyGas(prev.gas, inputs);
  if (gas.level === "poor" && prev.gas.level !== "poor") log("watch", "gas", `Air quality at gas metering down to ${gas.qualityPct}% of clean air`);
  if (gas.level === "good" && prev.gas.level === "poor") log("info", "gas", `Air quality at gas metering back to ${gas.qualityPct}%`);
  const demandMw = demandAt(t, rnd);
  const turbines = prev.turbines.map((tb) => ({ ...tb }));
  const advanceRow = t % ROW_SECONDS === 0;

  for (const id of inputs.tripRequests ?? []) {
    const tb = turbines.find((x) => x.id === id);
    if (tb && tb.status !== "tripped" && tb.status !== "offline") {
      tb.status = "tripped"; tb.tripCause = "Manual trip"; tb.outputMw = 0;
      log("trip", tb.id, `${tb.id} tripped by operator`);
    }
  }
  for (const id of inputs.resetRequests ?? []) {
    const tb = turbines.find((x) => x.id === id);
    if (tb && tb.status === "tripped") {
      tb.status = "running"; tb.tripCause = null;
      log("info", tb.id, `${tb.id} reset and restarting`);
    }
  }

  for (const tb of turbines) {
    const i = unitIndex(tb);
    const liveBoard = tb.id === LIVE_SENSOR_UNIT && board.source === "live" && board.features ? board.features : null;
    {
      if (tb.row === null) tb.row = startRow(i);
      tb.source = liveBoard ? "live" : "sim";
      // A tripped unit holds its last reading until someone fixes or resets it.
      if (advanceRow && tb.status !== "tripped") {
        const [start, end] = WINDOWS[i];
        tb.row += 1;
        if (tb.row >= end) {
          tb.row = start;
          log("info", tb.id, `${tb.id} tool changed at end of life, wear back to ${Math.round(rowFeatures(start).toolWearMin)} min`);
        }
        // Recorded failures don't trip the unit; the model sees them coming and recommends maintenance.
        tb.features = rowFeatures(tb.row);
      }
    }
    tb.measured = liveBoard ? (Object.keys(liveBoard).filter((k) => k !== "type") as (keyof Features)[]) : [];
    if (liveBoard) tb.features = { ...(tb.row === null ? tb.features : rowFeatures(tb.row)), ...liveBoard };
    tb.shaftPowerKw = shaftPowerW(tb.features) / 1000;
    tb.capacityMw = tb.ratedMw * derateFactor(tb.features.airTempK);
  }

  const remoteFresh = inputs.remote && inputs.remoteAtMs !== undefined && (inputs.nowMs ?? 0) - inputs.remoteAtMs < REMOTE_STALE_MS;
  const remotes = inputs.remote ? [inputs.remote].flat() : [];
  for (const tb of turbines) {
    if (tb.status !== "tripped") { tb.diagnosis = null; tb.tripReading = null; continue; }
    tb.tripReading ??= { ...tb.features };
    const r = remoteFresh ? remotes.find((p) => p.unit === tb.id) : undefined;
    if (tb.diagnosis || !r?.ml?.onTrip) continue;
    tb.diagnosis = r.ml;
    const types = r.ml.types.map((t) => t.name.toLowerCase()).join(" and ");
    log(r.ml.failureClass ? "trip" : "info", tb.id, r.ml.failureClass
      ? `${tb.id} model diagnosis: ${types || "failure, type unclear"} (${Math.round(r.probability * 100)}% risk)`
      : `${tb.id} model diagnosis: trip reading not flagged (${Math.round(r.probability * 100)}% risk)`);
  }

  const predictions: Prediction[] = turbines
    .filter((x) => x.status !== "tripped" && x.status !== "offline")
    .map((x) => {
      const r = remoteFresh ? remotes.find((p) => p.unit === x.id) : undefined;
      if (!r) return forecast(x.id, x.features);
      return r.ml ? fromService({ ...r, ml: r.ml }) : fromRemote(r);
    })
    .sort((a, b) => b.risk - a.risk);

  for (const tb of turbines) {
    const p = predictions.find((x) => x.turbineId === tb.id);
    if (tb.status === "running" && p && p.risk >= WATCH_RISK) {
      tb.status = "watch";
      log("watch", tb.id, `${tb.id} on watch: ${p.detail}`);
    } else if (tb.status === "watch" && (!p || p.risk < WATCH_RISK - 0.1)) {
      tb.status = "running";
      log("info", tb.id, `${tb.id} back to normal`);
    }
  }

  const available = turbines.filter((x) => x.status === "running" || x.status === "watch");
  const share = available.length ? demandMw / available.length : 0;
  for (const tb of turbines) {
    const running = tb.status === "running" || tb.status === "watch";
    const target = running ? Math.min(share, tb.capacityMw) : 0;
    const delta = Math.max(-18, Math.min(18, target - tb.outputMw));
    tb.outputMw = running ? Math.max(0, tb.outputMw + delta) : 0;
  }

  const outputMw = turbines.reduce((s, x) => s + x.outputMw, 0);
  const gap = demandMw - outputMw;
  const battery = { ...prev.battery };
  const energyMwh = (battery.socPct / 100) * battery.capacityMwh;
  let batteryMw = 0;
  if (gap > 0) batteryMw = Math.min(gap, battery.maxPowerMw, energyMwh * 3600);
  else batteryMw = -Math.min(-gap, battery.maxPowerMw, (battery.capacityMwh - energyMwh) * 3600);
  battery.powerMw = batteryMw;
  battery.socPct = Math.max(0, Math.min(100, battery.socPct - (batteryMw / 3600 / battery.capacityMwh) * 100));
  const gridMw = Math.max(0, gap - Math.max(0, batteryMw));
  if (gridMw > 1 && prev.gridMw <= 1) log("watch", "Grid", `Importing ${gridMw.toFixed(0)} MW from the grid`);
  if (batteryMw > 150 && prev.battery.powerMw <= 150) log("info", "Battery", `Battery covering ${batteryMw.toFixed(0)} MW`);
  const reserveMw = available.reduce((s, x) => s + x.capacityMw, 0) - outputMw + battery.maxPowerMw * (battery.socPct > 10 ? 1 : 0);

  // Maintenance: raise requests from what the sensors show, send the engineers the manager picked, walk, repair.
  const engineers = prev.engineers.map((e) => ({ ...e }));
  const requests = prev.requests.map((r) => ({ ...r }));
  const active = (r: MaintenanceRequest) => r.status !== "resolved" && r.status !== "cancelled";
  const openFor = (asset: string) => requests.find((r) => r.asset === asset && active(r));
  const recentlyFixed = (asset: string) =>
    requests.some((r) => r.asset === asset && r.status === "resolved" && r.resolvedT !== null && t - r.resolvedT < FIX_COOLDOWN_S);
  const create = (asset: string, reason: string, priority: Priority, origin: MaintenanceRequest["origin"], basis: MaintenanceRequest["basis"] = null) => {
    const r: MaintenanceRequest = {
      id: `MR-${101 + requests.length}`, asset, reason, priority, origin, basis, status: "open", createdT: t,
      engineerId: null, dispatchedT: null, path: [], progress: 0, etaMin: 0, repairLeftS: REPAIR_S, resolvedT: null,
    };
    requests.push(r);
    log(priority === "P1" ? "trip" : priority === "P2" ? "watch" : "info", asset, `${r.id} ${priority} ${asset}: ${reason}`);
    return r;
  };
  const engineerOf = (r: MaintenanceRequest) => engineers.find((e) => e.id === r.engineerId);

  for (const m of inputs.newRequests ?? []) {
    if (openFor(m.asset)) continue;
    create(m.asset, m.reason.trim() || "Inspection requested by the control room", "P2", "manual");
  }

  const recommendations = prev.recommendations.map((r) => ({ ...r }));
  for (const v of inputs.review ?? []) {
    const rec = recommendations.find((r) => r.id === v.recommendationId && r.status === "pending");
    if (!rec) continue;
    rec.decidedT = t;
    if (v.decision === "decline") {
      rec.status = "declined";
      log("info", rec.asset, `${rec.id} declined: no maintenance on ${rec.asset} for now`);
      continue;
    }
    const existing = openFor(rec.asset);
    const note = v.note.trim() || rec.action;
    const req = existing ?? create(rec.asset, note, PRIORITY_FOR[rec.alertLevel], "model", {
      risk: rec.risk, types: rec.types.map((x) => x.name), detail: rec.detail,
    });
    rec.status = "requested"; rec.requestId = req.id;
  }

  // Recommend maintenance once per asset and keep it current while it waits for the manager.
  type RecFields = Omit<Recommendation, "id" | "asset" | "createdT" | "status" | "decidedT" | "requestId">;
  const recommend = (asset: string, fields: RecFields) => {
    if (openFor(asset) || recentlyFixed(asset)) return;
    const pending = recommendations.find((r) => r.asset === asset && r.status === "pending");
    if (pending) {
      if (fields.risk >= pending.risk) Object.assign(pending, fields);
      return;
    }
    const declinedT = Math.max(-Infinity, ...recommendations.filter((r) => r.asset === asset && r.status === "declined").map((r) => r.decidedT ?? 0));
    if (t - declinedT < DECLINE_QUIET_S) return;
    const rec: Recommendation = { id: `RC-${101 + recommendations.length}`, asset, createdT: t, ...fields, status: "pending", decidedT: null, requestId: null };
    recommendations.push(rec);
    log("watch", asset, `${rec.id} maintenance recommended for ${assetLabel(asset)}: ${rec.detail}`);
  };

  for (const tb of turbines) {
    const pred = predictions.find((p) => p.turbineId === tb.id);
    if (!pred || !(pred.ml ? pred.ml.failureClass === 1 : pred.risk >= WATCH_RISK)) continue;
    const ml = pred.ml;
    recommend(tb.id, {
      updatedT: t,
      risk: pred.risk,
      alertLevel: ml?.alertLevel ?? (pred.risk >= 0.8 ? "Critical" : "Alert"),
      detail: pred.detail,
      by: pred.by,
      types: ml ? ml.types : pred.mode ? [{ code: pred.mode, name: FAILURE_NAME[pred.mode], probability: pred.risk }] : [],
      factors: ml?.factors ?? null,
      action: ml?.action ?? (pred.mode && FAILURE_ACTION[pred.mode]) ?? GENERAL_ACTION,
    });
  }

  if (gas.connected && gas.level === "poor" && gas.qualityPct !== null) {
    recommend("gas", {
      updatedT: t,
      risk: Math.round((1 - gas.qualityPct / 100) * 100) / 100,
      alertLevel: gas.qualityPct < 50 ? "Critical" : "Alert",
      detail: `Air quality at the gas metering skid fell to ${gas.qualityPct}% of clean air: possible gas leak`,
      by: "Air quality sensor",
      types: [],
      factors: null,
      action: GAS_LEAK_CHECK,
    });
  }

  for (const id of inputs.cancel ?? []) {
    const r = requests.find((x) => x.id === id && active(x));
    if (!r) continue;
    const e = engineerOf(r);
    if (e) { e.status = "available"; e.requestId = null; }
    r.status = "cancelled";
    log("info", r.asset, `${r.id} cancelled by the control room`);
  }

  // Only the manager sends an engineer; requests wait as open until then.
  for (const d of inputs.dispatch ?? []) {
    const r = requests.find((x) => x.id === d.requestId);
    const e = engineers.find((x) => x.id === d.engineerId);
    if (!r || !e || r.status !== "open" || e.status !== "available") continue;
    r.status = "dispatched"; r.engineerId = e.id; r.dispatchedT = t; r.path = routeFrom(e.pos, r.asset); r.progress = 0;
    e.status = "dispatched"; e.requestId = r.id;
    log("info", r.asset, `${r.id} dispatched to ${e.name}`);
  }

  for (const a of inputs.accept ?? []) {
    const r = requests.find((x) => x.id === a.requestId);
    const e = engineers.find((x) => x.id === a.engineerId);
    if (!r || !e || r.status !== "dispatched" || r.engineerId !== e.id) continue;
    r.status = "en-route"; e.status = "walking";
    log("info", r.asset, `${e.name} accepted ${r.id} and is heading to ${assetLabel(r.asset)}`);
  }
  for (const a of inputs.autoWalk ?? []) {
    const e = engineers.find((x) => x.id === a.engineerId);
    if (e) e.autoWalk = a.on;
  }
  for (const id of inputs.startRepair ?? []) {
    const r = requests.find((x) => x.id === id);
    const e = r && engineerOf(r);
    if (!r || !e || r.status !== "on-site") continue;
    r.status = "repairing"; e.status = "repairing";
    log("info", r.asset, `${e.name} started work on ${assetLabel(r.asset)}`);
  }

  const paceM = WALK_M_PER_S * SITE_REPLAY_SPEED;
  for (const r of requests) {
    const e = engineerOf(r);
    if (!e || !active(r)) continue;
    // Simulated crew accept, walk and start work on their own.
    if (e.kind === "sim" && r.status === "dispatched" && r.dispatchedT !== null && t - r.dispatchedT >= SIM_ACCEPT_S) {
      r.status = "en-route"; e.status = "walking";
      log("info", r.asset, `${e.name} accepted ${r.id} and is heading to ${assetLabel(r.asset)}`);
    }
    const len = Math.max(1, pathLength(r.path));
    if (r.status === "en-route") {
      const phoneMeters = (inputs.walkM ?? []).filter((w) => w.engineerId === e.id).reduce((s, w) => s + w.meters, 0);
      const meters = e.kind === "sim" || e.autoWalk ? paceM : phoneMeters;
      if (meters > 0) e.lastStepT = t;
      r.progress = Math.min(1, r.progress + meters / len);
      e.pos = pointOnPath(r.path, r.progress);
      if (r.progress >= 1) {
        r.status = "on-site"; e.status = "on-site";
        log("info", r.asset, `${e.name} arrived at ${assetLabel(r.asset)}`);
      }
    }
    // Work starts the moment the engineer arrives; the repair timer needs no button.
    if (r.status === "on-site") { r.status = "repairing"; e.status = "repairing"; log("info", r.asset, `${e.name} started work on ${assetLabel(r.asset)}`); }
    if (r.status === "repairing") {
      r.repairLeftS = Math.max(0, r.repairLeftS - 1);
      if (r.repairLeftS === 0) {
        r.status = "resolved"; r.resolvedT = t;
        e.status = "available"; e.requestId = null;
        const tb = turbines.find((x) => x.id === r.asset);
        if (tb) {
          // The repair fits a new tool, so replay continues from the start of this unit's tool life.
          fitNewTool(tb);
          tb.status = "running"; tb.tripCause = null;
        }
        log("info", r.asset, `${r.id} resolved: ${e.name} fixed ${assetLabel(r.asset)}`);
      }
    }
    const walkLeft = r.status === "dispatched" || r.status === "en-route" ? ((1 - r.progress) * len) / paceM : 0;
    r.etaMin = (walkLeft + (r.status === "resolved" ? 0 : r.repairLeftS)) / 60;
  }

  const riskHistory: Record<string, number[]> = {};
  for (const tb of turbines) {
    const p = predictions.find((x) => x.turbineId === tb.id);
    riskHistory[tb.id] = [...(prev.riskHistory[tb.id] ?? []).slice(-(RISK_HISTORY_LEN - 1)), tb.status === "tripped" ? 1 : p?.risk ?? 0];
  }
  const point: HistoryPoint = { t, demandMw, outputMw, batteryMw, gridMw };

  return {
    ...prev,
    t,
    demandMw,
    outputMw,
    gridMw,
    reserveMw,
    turbines,
    battery,
    board,
    gas,
    engineers,
    requests,
    recommendations: recommendations.slice(-RECOMMENDATION_LEN),
    predictions,
    events: [...events.reverse(), ...prev.events].slice(0, EVENT_LEN),
    history: [...prev.history.slice(-(HISTORY_LEN - 1)), point],
    riskHistory,
  };
}
