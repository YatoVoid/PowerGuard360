import type {
  Ambient, Engineer, HistoryPoint, MaintenanceRequest, PlantEvent, PlantState, Prediction, Priority, Severity, StepInputs, Turbine, TurbineSensors,
} from "../types";
import { CONTROL_ROOM, assetLabel, pathLength, pointOnPath, routeFrom } from "./site";

// All plant numbers here are illustrative. Real turbine data replaces this module's output later;
// the screens only read PlantState.

export const RATED_MW = 335;
export const TURBINE_COUNT = 8;
export const WATCH_TEMP_C = 640;
export const TRIP_TEMP_C = 660;
export const LIGHT_TRIP_THRESHOLD = 300;
const RAMP_MW_PER_S = 18;
const HISTORY_LEN = 300;
const TEMP_HISTORY_LEN = 180;
const EVENT_LEN = 60;
const SENSOR_STALE_MS = 5000;
// The sensor board on the table feeds GT-08; every other unit's sensors are simulated.
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

export function derateFactor(pressureHpa: number, temperatureC: number) {
  return Math.max(0.6, Math.min(1.05, (pressureHpa / 1013.25) * (1 - 0.006 * (temperatureC - 15))));
}

function demandAt(t: number, rnd: () => number) {
  const slow = 2050 + 140 * Math.sin((2 * Math.PI * t) / 900);
  // AI training jobs pull power in synchronized bursts.
  const inBurst = t % 90 < 32;
  const burst = inBurst ? 170 : 0;
  return slow + burst + (rnd() - 0.5) * 24;
}

function makeTurbine(i: number): Turbine {
  return {
    id: `GT-${String(i + 1).padStart(2, "0")}`,
    status: "running",
    tripCause: null,
    outputMw: 260,
    capacityMw: RATED_MW,
    ratedMw: RATED_MW,
    exhaustTempC: 585 + i * 1.5,
    vibrationMmS: 2.4 + (i % 3) * 0.3,
    rpm: 3600,
    fuelFlowKgS: 15,
    efficiencyPct: 38.5,
    runHours: 4200 + i * 611,
    sensors: { inletPressureHpa: 1009.2 + (i % 3) * 0.2, inletTempC: 32 + (i % 4) * 0.4, airQualityRaw: 130 + i * 4, flameRaw: 2780, source: "sim" },
  };
}

function simSensors(tb: Turbine, i: number, t: number, rnd: () => number, running: boolean): TurbineSensors {
  return {
    inletPressureHpa: 1009.2 + 0.6 * Math.sin(t / 400) + (i % 3) * 0.2 + (rnd() - 0.5) * 0.1,
    inletTempC: 32 + (i % 4) * 0.4 + 0.8 * Math.sin(t / 600) + (rnd() - 0.5) * 0.2,
    airQualityRaw: Math.max(40, tb.sensors.airQualityRaw + (130 + i * 4 - tb.sensors.airQualityRaw) * 0.05 + (rnd() - 0.5) * 5),
    flameRaw: running ? 2780 + (rnd() - 0.5) * 60 : 40,
    source: "sim",
  };
}

export function createPlant(seed = 7): PlantState {
  const turbines = Array.from({ length: TURBINE_COUNT }, (_, i) => makeTurbine(i));
  const tempHistory: Record<string, number[]> = {};
  for (const tb of turbines) tempHistory[tb.id] = [];
  return {
    t: 0,
    seed,
    demandMw: 2050,
    outputMw: 0,
    gridMw: 0,
    reserveMw: 0,
    turbines,
    battery: { socPct: 82, powerMw: 0, capacityMwh: 800, maxPowerMw: 400 },
    ambient: { pressureHpa: 1009.2, temperatureC: 31, airQualityRaw: 140, lightRaw: 2800, source: "sim", lastSeenMs: null },
    engineers: initialEngineers(),
    requests: [],
    predictions: [],
    events: [{ id: 0, t: 0, severity: "info", asset: LIVE_SENSOR_UNIT, text: `${LIVE_SENSOR_UNIT} reads the site sensor board when it is connected` }],
    history: [],
    tempHistory,
    excessHistory: {},
    simWear: {},
    expectedExhaustC: Object.fromEntries(turbines.map((tb) => [tb.id, tb.exhaustTempC])),
  };
}

// Exhaust temperature a healthy unit settles at for a given load.
export function healthyExhaustC(load: number) {
  return 560 + 45 * load;
}

// Watches how far a unit runs above a healthy unit at the same load ("excess"). Load swings move both
// together, so only real degradation makes the excess climb. Stand-in until the ML model is trained on real data.
export function predictOverheat(id: string, temps: number[], excess: number[]): Prediction {
  const none: Prediction = { turbineId: id, issue: "overheat", minutesToLimit: null, risk: 0 };
  if (excess.length < 60 || temps.length === 0) return none;
  const recent = excess.slice(-60);
  const n = recent.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += recent[i]; sxy += i * recent[i]; sxx += i * i; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const last = temps[temps.length - 1];
  const headroom = TRIP_TEMP_C - last;
  // Require a real rise, not a tilt in the noise, and only surface what an operator can act on soon.
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const rise = mean(recent.slice(-15)) - mean(recent.slice(0, 15));
  const runningHot = recent[n - 1] > 4;
  const minutes = runningHot && slope > 0.03 && rise > 2.5 && headroom > 0 ? headroom / slope / 60 : null;
  const minutesToLimit = minutes !== null && minutes <= 20 ? minutes : null;
  const proximity = Math.min(1, Math.max(0, (last - 610) / (TRIP_TEMP_C - 610)));
  const urgency = minutesToLimit === null ? 0 : Math.min(1, 10 / Math.max(minutesToLimit, 0.5));
  return { turbineId: id, issue: "overheat", minutesToLimit, risk: Math.round(100 * Math.max(proximity * 0.6, urgency)) / 100 };
}

function applySensor(prev: Ambient, inputs: StepInputs): Ambient {
  const now = inputs.nowMs ?? 0;
  const r = inputs.sensor?.readings;
  if (r && inputs.sensorAtMs !== undefined) {
    return {
      pressureHpa: r.pressure_hpa ?? prev.pressureHpa,
      temperatureC: r.temperature_c ?? prev.temperatureC,
      airQualityRaw: r.air_quality_raw ?? prev.airQualityRaw,
      lightRaw: r.light_raw ?? prev.lightRaw,
      source: now - inputs.sensorAtMs < SENSOR_STALE_MS ? "live" : "sim",
      lastSeenMs: inputs.sensorAtMs,
    };
  }
  return { ...prev, source: prev.lastSeenMs !== null && now - prev.lastSeenMs < SENSOR_STALE_MS ? "live" : "sim" };
}

export function step(prev: PlantState, inputs: StepInputs = {}): PlantState {
  const t = prev.t + 1;
  const rnd = mulberry32(prev.seed * 100003 + t);
  const events: PlantEvent[] = [];
  let nextEventId = (prev.events[0]?.id ?? 0) + 1;
  const log = (severity: Severity, asset: string, text: string) => events.push({ id: nextEventId++, t, severity, asset, text });

  let ambient = applySensor(prev.ambient, inputs);
  if (ambient.source === "sim") {
    ambient = {
      ...ambient,
      pressureHpa: ambient.pressureHpa + (1009.2 - ambient.pressureHpa) * 0.02 + (rnd() - 0.5) * 0.15,
      airQualityRaw: Math.max(40, ambient.airQualityRaw + (rnd() - 0.5) * 6),
    };
  }
  const demandMw = demandAt(t, rnd);

  const turbines = prev.turbines.map((tb) => ({ ...tb }));
  const simWear = { ...prev.simWear };
  const expected = { ...prev.expectedExhaustC };

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
      simWear[tb.id] = 0;
      log("info", tb.id, `${tb.id} reset and restarting`);
    }
  }

  turbines.forEach((tb, i) => {
    const running = tb.status === "running" || tb.status === "watch";
    if (tb.id === LIVE_SENSOR_UNIT && ambient.source === "live") {
      tb.sensors = {
        inletPressureHpa: ambient.pressureHpa,
        inletTempC: ambient.temperatureC,
        airQualityRaw: ambient.airQualityRaw,
        flameRaw: ambient.lightRaw,
        source: "live",
      };
    } else {
      tb.sensors = simSensors(tb, i, t, rnd, running);
    }
    // Each unit's capacity follows its own inlet air: thinner, hotter air makes less power.
    tb.capacityMw = tb.ratedMw * derateFactor(tb.sensors.inletPressureHpa, tb.sensors.inletTempC);
  });

  // The light sensor is GT-08's flame detector: cover it and the unit trips.
  const live = turbines.find((x) => x.id === LIVE_SENSOR_UNIT);
  if (live && live.sensors.source === "live" && live.sensors.flameRaw < LIGHT_TRIP_THRESHOLD && (live.status === "running" || live.status === "watch")) {
    live.status = "tripped"; live.tripCause = "Flame detector lost signal"; live.outputMw = 0;
    log("trip", live.id, `${live.id} tripped: flame detector lost signal`);
  }

  const available = turbines.filter((x) => x.status === "running" || x.status === "watch");
  const share = available.length ? demandMw / available.length : 0;

  for (const tb of turbines) {
    const running = tb.status === "running" || tb.status === "watch";
    const target = running ? Math.min(share, tb.capacityMw) : 0;
    const delta = Math.max(-RAMP_MW_PER_S, Math.min(RAMP_MW_PER_S, target - tb.outputMw));
    tb.outputMw = running ? Math.max(0, tb.outputMw + delta) : 0;
    const load = tb.outputMw / tb.ratedMw;

    // GT-03 carries a slowly failing combustion liner, which is why its spare is on the truck.
    if (tb.id === "GT-03" && running) simWear[tb.id] = (simWear[tb.id] ?? 0) + 0.11;
    const healthy = running ? healthyExhaustC(load) : 120;
    tb.exhaustTempC += (healthy + (simWear[tb.id] ?? 0) - tb.exhaustTempC) * 0.08 + (rnd() - 0.5) * 1.2;
    // The healthy reference follows the same thermal lag, so bursts in load don't show up as excess.
    expected[tb.id] = (expected[tb.id] ?? tb.exhaustTempC) + (healthy - (expected[tb.id] ?? tb.exhaustTempC)) * 0.08;
    tb.vibrationMmS = running ? Math.max(0.5, 2.2 + load * 1.1 + (tb.exhaustTempC > WATCH_TEMP_C ? 1.6 : 0) + (rnd() - 0.5) * 0.3) : 0.1;
    tb.rpm = running ? 3600 + (rnd() - 0.5) * 4 : Math.max(0, tb.rpm * 0.9);
    tb.efficiencyPct = running ? 30 + 9.5 * Math.min(load, 1) - (tb.exhaustTempC > WATCH_TEMP_C ? 1.2 : 0) : 0;
    // Fuel heat input (MW) / LHV of natural gas (~47 MJ/kg) = kg/s
    tb.fuelFlowKgS = running && tb.efficiencyPct > 0 ? tb.outputMw / (tb.efficiencyPct / 100) / 47 : 0;
    if (running) tb.runHours += 1 / 3600;

    if (running && tb.exhaustTempC >= TRIP_TEMP_C) {
      tb.status = "tripped"; tb.tripCause = "Exhaust over-temperature"; tb.outputMw = 0;
      log("trip", tb.id, `${tb.id} tripped: exhaust ${tb.exhaustTempC.toFixed(0)} °C over limit`);
    } else if (tb.status === "running" && tb.exhaustTempC >= WATCH_TEMP_C) {
      tb.status = "watch";
      log("watch", tb.id, `${tb.id} exhaust temperature above ${WATCH_TEMP_C} °C`);
    } else if (tb.status === "watch" && tb.exhaustTempC < WATCH_TEMP_C - 5) {
      tb.status = "running";
      log("info", tb.id, `${tb.id} exhaust temperature back to normal`);
    }
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

  const tempHistory: Record<string, number[]> = {};
  const excessHistory: Record<string, number[]> = {};
  for (const tb of turbines) {
    const h = prev.tempHistory[tb.id] ?? [];
    tempHistory[tb.id] = [...h.slice(-(TEMP_HISTORY_LEN - 1)), tb.exhaustTempC];
    const running = tb.status === "running" || tb.status === "watch";
    // A stopped unit has no meaningful excess; restart its history so cool-down doesn't read as a trend.
    excessHistory[tb.id] = running
      ? [...(prev.excessHistory[tb.id] ?? []).slice(-(TEMP_HISTORY_LEN - 1)), tb.exhaustTempC - expected[tb.id]]
      : [];
  }
  const predictions = turbines
    .filter((x) => x.status === "running" || x.status === "watch")
    .map((x) => predictOverheat(x.id, tempHistory[x.id], excessHistory[x.id]))
    .sort((a, b) => b.risk - a.risk);

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
    else if (tb.status === "watch") { priority = "P2"; reason = `Exhaust ${tb.exhaustTempC.toFixed(0)} °C, above the ${WATCH_TEMP_C} °C watch limit`; }
    else if (pred && pred.minutesToLimit !== null && !recentlyFixed(tb.id)) { priority = "P3"; reason = `Overheat forecast in about ${pred.minutesToLimit.toFixed(1)} min`; }
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
          simWear[tb.id] = 0;
          if (tb.status === "tripped") { tb.status = "running"; tb.tripCause = null; }
        }
        log("info", r.asset, `${r.id} resolved: ${e.name} fixed ${assetLabel(r.asset)}`);
      }
    }
    const walkLeft = r.status === "dispatched" || r.status === "en-route" ? ((1 - r.progress) * len) / paceM : 0;
    r.etaMin = (walkLeft + (r.status === "resolved" ? 0 : r.repairLeftS)) / 60;
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
    ambient,
    engineers,
    requests,
    predictions,
    events: [...events.reverse(), ...prev.events].slice(0, EVENT_LEN),
    history: [...prev.history.slice(-(HISTORY_LEN - 1)), point],
    tempHistory,
    excessHistory,
    simWear,
    expectedExhaustC: expected,
  };
}

