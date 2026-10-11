import type {
  Board, Engineer, Features, HistoryPoint, MaintenanceRequest, PlantEvent, PlantState, Prediction, Priority, RemotePrediction, Severity, StepInputs, Turbine,
} from "../types";
import { CONTROL_ROOM, assetLabel, pathLength, pointOnPath, routeFrom } from "./site";
import {
  FAILURE_NAME, HDF_GAP_K, HDF_RPM, OSF_LIMIT, PWF_MAX_W, PWF_MIN_W, TWF_PER_ROW, TWF_WEAR_MIN, WINDOWS,
  failureProbability, rowFailure, rowFeatures, shaftPowerW,
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
const SENSOR_STALE_MS = 5000;
// The ML laptop's forecast replaces the tree's for its unit while it keeps posting.
const REMOTE_STALE_MS = 15000;
// Raise a P3 request when a failure is forecast within this many minutes.
export const REQUEST_LEAD_MIN = 2;
export const WATCH_RISK = 0.5;
// Torque spread across the dataset, used to judge the chance that the next cut overstrains the tool.
const TORQUE_MEAN = 40;
const TORQUE_SD = 10;
const WEAR_PER_ROW = 2.5;

// The sensor board on the table feeds GT-08; every other unit replays the dataset.
export const LIVE_SENSOR_UNIT = "GT-08";
// Walking pace on site, replayed faster for the demo.
export const WALK_M_PER_S = 1.3;
export const SITE_REPLAY_SPEED = 3;
export const REPAIR_S = 25;
const SIM_ACCEPT_S = 4;
// After a fix, give the readings time to settle before the forecast can raise a new request.
const FIX_COOLDOWN_S = 120;
const PRIORITY_RANK: Record<Priority, number> = { P1: 0, P2: 1, P3: 2 };

export const PHONE_ENGINEER = "ENG-1";
function initialEngineers(): Engineer[] {
  return [
    { id: PHONE_ENGINEER, name: "Phone engineer", kind: "phone", status: "available", requestId: null, pos: CONTROL_ROOM, autoWalk: false, lastStepT: null },
    { id: "ENG-2", name: "R. Alvarez", kind: "sim", status: "available", requestId: null, pos: CONTROL_ROOM, autoWalk: false, lastStepT: null },
    { id: "ENG-3", name: "J. Chen", kind: "sim", status: "available", requestId: null, pos: CONTROL_ROOM, autoWalk: false, lastStepT: null },
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
  };
}

const normalTail = (z: number) => 0.5 * erfc(z / Math.SQRT2);
function erfc(x: number) {
  // Abramowitz and Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return x >= 0 ? y : 2 - y;
}

// Forecast for one unit from its current six features, using the dataset's own failure mechanics:
// - the trained tree scores the current reading (catches heat dissipation and power failures as they form),
// - overstrain: chance that an upcoming cut's torque crosses limit / wear as the tool keeps wearing,
// - tool wear: the dataset's failure rate once a tool passes 200 minutes.
export function forecast(id: string, f: Features, wearPerRow = WEAR_PER_ROW): Prediction {
  const probability = failureProbability(f);
  const limit = OSF_LIMIT[f.type];
  const rowsPerMin = 60 / ROW_SECONDS;
  const rate = Math.max(0.5, wearPerRow);

  const rowRisk = (k: number) => {
    const wear = f.toolWearMin + k * rate;
    const osf = wear > 0 ? normalTail((limit / wear - TORQUE_MEAN) / TORQUE_SD) : 0;
    const twf = wear >= TWF_WEAR_MIN ? TWF_PER_ROW : 0;
    return { osf, twf };
  };
  let surviveOsf = 1, surviveTwf = 1;
  let nextMinOsf = 0, nextMinTwf = 0;
  let firstOsf: number | null = null, firstTwf: number | null = null;
  for (let k = 1; k <= 20 * rowsPerMin; k++) {
    const r = rowRisk(k);
    surviveOsf *= 1 - r.osf;
    surviveTwf *= 1 - r.twf;
    if (k === rowsPerMin) { nextMinOsf = 1 - surviveOsf; nextMinTwf = 1 - surviveTwf; }
    if (firstOsf === null && 1 - surviveOsf >= 0.5) firstOsf = k / rowsPerMin;
    if (firstTwf === null && 1 - surviveTwf >= 0.5) firstTwf = k / rowsPerMin;
  }
  const strainPct = Math.round(((f.toolWearMin * TORQUE_MEAN) / limit) * 100);
  const options = [
    { mode: "OSF" as const, risk: nextMinOsf, min: firstOsf, detail: `Overstrain likely in about ${fmtMin(firstOsf)}: at ${Math.round(f.toolWearMin)} min of tool wear a typical cut is at ${strainPct}% of the ${limit.toLocaleString("en-US")} limit` },
    { mode: "TWF" as const, risk: nextMinTwf, min: firstTwf, detail: f.toolWearMin >= TWF_WEAR_MIN ? `Tool at ${Math.round(f.toolWearMin)} min of wear, past its 200 min end of life` : `Tool reaches end of life in about ${fmtMin(firstTwf)} (${Math.round(f.toolWearMin)} of 200 min)` },
  ];
  const soonest = options.filter((o) => o.min !== null).sort((a, b) => (a.min ?? 0) - (b.min ?? 0))[0];
  const worst = [...options].sort((a, b) => b.risk - a.risk)[0];
  const risk = Math.min(1, Math.max(probability, worst.risk));
  const lead = probability >= worst.risk && probability >= 0.3 ? null : soonest ?? worst;
  return {
    turbineId: id,
    probability,
    mode: lead?.mode ?? null,
    minutesToFailure: soonest?.min ?? null,
    risk: Math.round(risk * 100) / 100,
    detail: lead ? lead.detail : `Model gives ${Math.round(probability * 100)}% failure probability on the current reading`,
    by: "Decision tree",
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

function fmtMin(min: number | null) {
  if (min === null) return "more than 20 min";
  return min < 1 ? `${Math.max(1, Math.round(min * 60))} s` : `${min.toFixed(1)} min`;
}

function applyBoard(prev: Board, inputs: StepInputs): Board {
  const now = inputs.nowMs ?? 0;
  const r = inputs.sensor?.readings;
  if (r && inputs.sensorAtMs !== undefined) {
    const base = prev.features;
    const ok = r.air_temp_k !== undefined && r.process_temp_k !== undefined && r.rpm !== undefined && r.torque_nm !== undefined && r.tool_wear_min !== undefined;
    const features: Features | null = ok
      ? { type: r.type ?? base?.type ?? "L", airTempK: r.air_temp_k!, processTempK: r.process_temp_k!, rpm: r.rpm!, torqueNm: r.torque_nm!, toolWearMin: r.tool_wear_min! }
      : base;
    return { features, lastSeenMs: inputs.sensorAtMs, source: features && now - inputs.sensorAtMs < SENSOR_STALE_MS ? "live" : "sim" };
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
    engineers: initialEngineers(),
    requests: [],
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
  const demandMw = demandAt(t, rnd);
  const turbines = prev.turbines.map((tb) => ({ ...tb }));
  const advanceRow = t % ROW_SECONDS === 0;
  const wearRate: Record<string, number> = {};

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
    const before = tb.features;
    if (tb.id === LIVE_SENSOR_UNIT && board.source === "live" && board.features) {
      tb.features = board.features;
      tb.source = "live";
      tb.row = null;
    } else {
      if (tb.row === null) tb.row = startRow(i);
      tb.source = "sim";
      // A tripped unit holds its last reading until someone fixes or resets it.
      if (advanceRow && tb.status !== "tripped") {
        const [start, end] = WINDOWS[i];
        tb.row += 1;
        if (tb.row >= end) {
          tb.row = start;
          log("info", tb.id, `${tb.id} tool changed at end of life, wear back to ${Math.round(rowFeatures(start).toolWearMin)} min`);
        }
        const failure = rowFailure(tb.row);
        tb.features = rowFeatures(tb.row);
        if (failure) {
          tb.status = "tripped"; tb.tripCause = FAILURE_NAME[failure]; tb.outputMw = 0;
          log("trip", tb.id, `${tb.id} tripped: ${FAILURE_NAME[failure].toLowerCase()} (dataset row ${tb.row + 1})`);
        }
      }
    }
    const grew = tb.features.toolWearMin - before.toolWearMin;
    wearRate[tb.id] = grew > 0 && grew < 20 ? grew : WEAR_PER_ROW;
    tb.shaftPowerKw = shaftPowerW(tb.features) / 1000;
    tb.capacityMw = tb.ratedMw * derateFactor(tb.features.airTempK);
  }

  // Live board: trip on the same rules the dataset uses to label failures.
  const live = turbines.find((x) => x.id === LIVE_SENSOR_UNIT && x.source === "live");
  if (live && (live.status === "running" || live.status === "watch")) {
    const f = live.features;
    const w = shaftPowerW(f);
    const mode = f.toolWearMin * f.torqueNm > OSF_LIMIT[f.type] ? "OSF"
      : f.processTempK - f.airTempK < HDF_GAP_K && f.rpm < HDF_RPM ? "HDF"
      : w < PWF_MIN_W || w > PWF_MAX_W ? "PWF" : null;
    if (mode) {
      live.status = "tripped"; live.tripCause = FAILURE_NAME[mode]; live.outputMw = 0;
      log("trip", live.id, `${live.id} tripped: ${FAILURE_NAME[mode].toLowerCase()} on live sensor readings`);
    }
  }

  const predictions: Prediction[] = turbines
    .filter((x) => x.status !== "tripped" && x.status !== "offline")
    .map((x) => {
      const remoteFresh = inputs.remote && inputs.remoteAtMs !== undefined && (inputs.nowMs ?? 0) - inputs.remoteAtMs < REMOTE_STALE_MS;
      return remoteFresh && inputs.remote!.unit === x.id ? fromRemote(inputs.remote!) : forecast(x.id, x.features, wearRate[x.id]);
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

  // Maintenance: raise requests from what the sensors show, dispatch engineers, walk, repair.
  const engineers = prev.engineers.map((e) => ({ ...e }));
  const requests = prev.requests.map((r) => ({ ...r }));
  const active = (r: MaintenanceRequest) => r.status !== "resolved" && r.status !== "cancelled";
  const openFor = (asset: string) => requests.find((r) => r.asset === asset && active(r));
  const recentlyFixed = (asset: string) =>
    requests.some((r) => r.asset === asset && r.status === "resolved" && r.resolvedT !== null && t - r.resolvedT < FIX_COOLDOWN_S);
  const create = (asset: string, reason: string, priority: Priority, origin: "auto" | "manual") => {
    const r: MaintenanceRequest = {
      id: `MR-${101 + requests.length}`, asset, reason, priority, origin, status: "open", createdT: t,
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

  for (const tb of turbines) {
    let priority: Priority | null = null;
    let reason = "";
    const pred = predictions.find((p) => p.turbineId === tb.id);
    if (tb.status === "tripped") { priority = "P1"; reason = `Tripped: ${(tb.tripCause ?? "unknown cause").toLowerCase()}`; }
    else if (tb.status === "watch" && pred) { priority = "P2"; reason = pred.detail; }
    else if (pred && pred.minutesToFailure !== null && pred.minutesToFailure <= REQUEST_LEAD_MIN && !recentlyFixed(tb.id)) { priority = "P3"; reason = pred.detail; }
    if (!priority) continue;
    const existing = openFor(tb.id);
    if (!existing) create(tb.id, reason, priority, "auto");
    else if (PRIORITY_RANK[priority] < PRIORITY_RANK[existing.priority]) {
      existing.priority = priority; existing.reason = reason;
      log(priority === "P1" ? "trip" : "watch", tb.id, `${existing.id} raised to ${priority}: ${reason}`);
    }
  }

  for (const id of inputs.cancel ?? []) {
    const r = requests.find((x) => x.id === id && active(x));
    if (!r) continue;
    const e = engineerOf(r);
    if (e) { e.status = "available"; e.requestId = null; }
    r.status = "cancelled";
    log("info", r.asset, `${r.id} cancelled by the control room`);
  }

  // Most urgent first; the phone engineer gets first pick so the person carrying the app is in the loop.
  const queue = requests.filter((r) => r.status === "open").sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdT - b.createdT);
  for (const r of queue) {
    const free = engineers.filter((e) => e.status === "available").sort((a, b) => (a.kind === "phone" ? -1 : 0) - (b.kind === "phone" ? -1 : 0));
    const e = free[0];
    if (!e) break;
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
    if (e.kind === "sim" && r.status === "on-site") { r.status = "repairing"; e.status = "repairing"; log("info", r.asset, `${e.name} started work on ${assetLabel(r.asset)}`); }
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
    engineers,
    requests,
    predictions,
    events: [...events.reverse(), ...prev.events].slice(0, EVENT_LEN),
    history: [...prev.history.slice(-(HISTORY_LEN - 1)), point],
    riskHistory,
  };
}
