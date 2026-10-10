import type {
  Ambient, Delivery, HistoryPoint, PlantEvent, PlantState, Prediction, Severity, Shipment, StepInputs, Turbine, TurbineSensors,
} from "../types";
import { deliveryTarget, pathLength, pointOnPath } from "./site";

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
export const SHIPMENT_REPLAY_SPEED = 12;
export const GEOFENCE_KM = 3;
// The sensor board on the table feeds GT-08; every other unit's sensors are simulated.
export const LIVE_SENSOR_UNIT = "GT-08";
// Walking pace on site, replayed faster for the demo the same way the trucks are.
export const WALK_M_PER_S = 1.3;
export const SITE_REPLAY_SPEED = 3;
const UNLOAD_S = 20;
const CREWS = ["Crew A", "Crew B", "Crew C"];

export const SITE_LON_LAT: [number, number] = [-103.56, 31.37];

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

export function routeLengthKm(route: [number, number][]) {
  let km = 0;
  for (let i = 1; i < route.length; i++) km += haversineKm(route[i - 1], route[i]);
  return km;
}

export function pointAlong(route: [number, number][], progress: number): [number, number] {
  const total = routeLengthKm(route);
  let target = Math.min(Math.max(progress, 0), 1) * total;
  for (let i = 1; i < route.length; i++) {
    const seg = haversineKm(route[i - 1], route[i]);
    if (target <= seg || i === route.length - 1) {
      const f = seg === 0 ? 0 : Math.min(target / seg, 1);
      return [route[i - 1][0] + (route[i][0] - route[i - 1][0]) * f, route[i - 1][1] + (route[i][1] - route[i - 1][1]) * f];
    }
    target -= seg;
  }
  return route[route.length - 1];
}

// Gas turbine output falls with air density: lower pressure and hotter air both cut capacity.
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

type NamedPoint = { name?: string; at: [number, number] };

const MIDLAND_ROUTE: NamedPoint[] = [
  { name: "Midland", at: [-102.078, 31.997] }, { name: "Odessa", at: [-102.368, 31.845] }, { at: [-102.62, 31.72] },
  { name: "Monahans", at: [-102.892, 31.594] }, { at: [-103.127, 31.538] }, { at: [-103.31, 31.47] },
  { name: "Pecos", at: [-103.493, 31.423] }, { name: "Plant", at: SITE_LON_LAT },
];
const FORT_STOCKTON_ROUTE: NamedPoint[] = [
  { name: "Fort Stockton", at: [-102.879, 30.894] }, { at: [-103.02, 30.98] }, { at: [-103.2, 31.12] },
  { at: [-103.36, 31.27] }, { name: "Pecos", at: [-103.493, 31.423] }, { name: "Plant", at: SITE_LON_LAT },
];

function makeShipment(
  id: string, cargo: string, forAsset: string, carrier: string, points: NamedPoint[], speedKmh: number, startProgress: number,
): Shipment {
  const route = points.map((p) => p.at);
  const total = routeLengthKm(route);
  const stops: Shipment["stops"] = [];
  let km = 0;
  points.forEach((p, i) => {
    if (i > 0) km += haversineKm(points[i - 1].at, p.at);
    if (p.name) stops.push({ name: p.name, at: km / total });
  });
  const [lon, lat] = pointAlong(route, startProgress);
  const remainingKm = total * (1 - startProgress);
  return {
    id, cargo, forAsset, carrier, route, stops,
    origin: points[0].name ?? "",
    progress: startProgress,
    speedKmh,
    source: "sim",
    lat, lon,
    remainingKm,
    etaMin: (remainingKm / (speedKmh * SHIPMENT_REPLAY_SPEED)) * 60,
    arrived: false,
    lastPingT: null,
  };
}

export function initialShipments(): Shipment[] {
  return [
    makeShipment("TRL-204", "Combustion liner set", "GT-03", "Permian Freight", MIDLAND_ROUTE, 96, 0),
    makeShipment("TNK-118", "Turbine lube oil, 6,000 gal", "Lube oil system", "Basin Fluids", MIDLAND_ROUTE.slice(1), 88, 0.3),
    makeShipment("TRL-311", "Replacement battery modules (12)", "battery", "Trans-Pecos Haul", FORT_STOCKTON_ROUTE, 80, 0.12),
  ];
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
    shipments: initialShipments(),
    deliveries: [],
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

  const shipments = prev.shipments.map((sh) => {
    const s = { ...sh };
    const total = routeLengthKm(s.route);
    const before = s.remainingKm;
    const phone = inputs.gpsKm?.find((g) => g.shipmentId === s.id);
    if (inputs.gpsRelease?.includes(s.id)) s.source = "sim";
    if (inputs.gps && inputs.gps.shipmentId === s.id) {
      s.lat = inputs.gps.lat; s.lon = inputs.gps.lon; s.source = "live"; s.lastPingT = t;
      s.remainingKm = haversineKm([s.lon, s.lat], SITE_LON_LAT);
      s.progress = Math.max(0, Math.min(1, 1 - s.remainingKm / total));
    } else if (phone && !s.arrived) {
      s.source = "live"; s.lastPingT = t;
      s.progress = Math.min(1, s.progress + phone.km / total);
      [s.lon, s.lat] = pointAlong(s.route, s.progress);
      s.remainingKm = total * (1 - s.progress);
    } else if (s.source === "sim" && !s.arrived) {
      s.progress = Math.min(1, s.progress + (s.speedKmh / 3600) * SHIPMENT_REPLAY_SPEED / total);
      [s.lon, s.lat] = pointAlong(s.route, s.progress);
      s.remainingKm = total * (1 - s.progress);
    }
    s.etaMin = (s.remainingKm / (s.speedKmh * SHIPMENT_REPLAY_SPEED)) * 60;
    if (before > GEOFENCE_KM && s.remainingKm <= GEOFENCE_KM && !s.arrived) log("info", s.id, `${s.id} entered the site geofence`);
    if (!s.arrived && s.remainingKm < 0.3) {
      s.arrived = true;
      log("info", s.id, `${s.id} arrived on site: ${s.cargo.toLowerCase()}`);
    }
    return s;
  });

  const deliveries: Delivery[] = prev.deliveries.map((d) => ({ ...d }));
  shipments.forEach((sh, i) => {
    if (!sh.arrived || deliveries.some((d) => d.shipmentId === sh.id)) return;
    const target = deliveryTarget(sh.forAsset);
    deliveries.push({
      shipmentId: sh.id, cargo: sh.cargo, crew: CREWS[i % CREWS.length], workers: i === 1 ? 2 : 3,
      toAsset: sh.forAsset, toLabel: target.label, path: target.path,
      status: "unloading", unloadLeftS: UNLOAD_S, progress: 0, pos: target.path[0], etaMin: 0, deliveredT: null,
    });
    log("info", sh.id, `${CREWS[i % CREWS.length]} unloading ${sh.id} at the dock`);
  });
  const stepM = WALK_M_PER_S * SITE_REPLAY_SPEED;
  for (const d of deliveries) {
    const len = pathLength(d.path);
    if (d.status === "unloading") {
      d.unloadLeftS = Math.max(0, d.unloadLeftS - 1);
      if (d.unloadLeftS === 0) {
        d.status = "carrying";
        log("info", d.shipmentId, `${d.crew} carrying ${d.cargo.toLowerCase()} to the ${d.toLabel}`);
      }
    } else if (d.status === "carrying") {
      d.progress = Math.min(1, d.progress + stepM / len);
      d.pos = pointOnPath(d.path, d.progress);
      if (d.progress >= 1) {
        d.status = "delivered"; d.deliveredT = t;
        log("info", d.shipmentId, `${d.crew} delivered ${d.cargo.toLowerCase()} to the ${d.toLabel}`);
      }
    }
    d.etaMin = d.status === "delivered" ? 0 : (d.unloadLeftS + ((1 - d.progress) * len) / stepM) / 60;
  }

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
    shipments,
    deliveries,
    predictions,
    events: [...events.reverse(), ...prev.events].slice(0, EVENT_LEN),
    history: [...prev.history.slice(-(HISTORY_LEN - 1)), point],
    tempHistory,
    excessHistory,
    simWear,
    expectedExhaustC: expected,
  };
}

export function splitRoute(route: [number, number][], progress: number): [[number, number][], [number, number][]] {
  const here = pointAlong(route, progress);
  const total = routeLengthKm(route);
  const driven: [number, number][] = [route[0]];
  let km = 0;
  let i = 1;
  for (; i < route.length; i++) {
    km += haversineKm(route[i - 1], route[i]);
    if (km / total > progress) break;
    driven.push(route[i]);
  }
  driven.push(here);
  return [driven, [here, ...route.slice(i)]];
}
