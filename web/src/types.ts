export type Source = "live" | "sim";

export type TurbineStatus = "running" | "watch" | "tripped" | "offline";

export interface TurbineSensors {
  inletPressureHpa: number;
  inletTempC: number;
  airQualityRaw: number;
  flameRaw: number;
  source: Source;
}

export interface Turbine {
  id: string;
  status: TurbineStatus;
  tripCause: string | null;
  outputMw: number;
  capacityMw: number;
  ratedMw: number;
  exhaustTempC: number;
  vibrationMmS: number;
  rpm: number;
  fuelFlowKgS: number;
  efficiencyPct: number;
  runHours: number;
  sensors: TurbineSensors;
}

export interface Ambient {
  pressureHpa: number;
  temperatureC: number;
  airQualityRaw: number;
  lightRaw: number;
  source: Source;
  lastSeenMs: number | null;
}

export interface Battery {
  socPct: number;
  powerMw: number;
  capacityMwh: number;
  maxPowerMw: number;
}

export interface Prediction {
  turbineId: string;
  issue: "overheat";
  minutesToLimit: number | null;
  risk: number;
}

export type Severity = "info" | "watch" | "trip";

export interface PlantEvent {
  id: number;
  t: number;
  severity: Severity;
  asset: string;
  text: string;
}

export interface HistoryPoint {
  t: number;
  demandMw: number;
  outputMw: number;
  batteryMw: number;
  gridMw: number;
}

export interface PlantState {
  t: number;
  seed: number;
  demandMw: number;
  outputMw: number;
  gridMw: number;
  reserveMw: number;
  turbines: Turbine[];
  battery: Battery;
  ambient: Ambient;
  engineers: Engineer[];
  requests: MaintenanceRequest[];
  predictions: Prediction[];
  events: PlantEvent[];
  history: HistoryPoint[];
  tempHistory: Record<string, number[]>;
  simWear: Record<string, number>;
  excessHistory: Record<string, number[]>;
  expectedExhaustC: Record<string, number>;
}

export interface SensorReading {
  device: string;
  seq: number;
  uptime_ms: number;
  readings: {
    air_quality_raw?: number;
    pressure_hpa?: number;
    temperature_c?: number;
    light_raw?: number;
  };
}

export interface StepInputs {
  sensor?: SensorReading | null;
  sensorAtMs?: number;
  nowMs?: number;
  tripRequests?: string[];
  resetRequests?: string[];
  // Maintenance: manual requests from the manager, and the phone engineer's actions.
  newRequests?: { asset: string; reason: string }[];
  accept?: { requestId: string; engineerId: string }[];
  walkM?: { engineerId: string; meters: number }[];
  autoWalk?: { engineerId: string; on: boolean }[];
  startRepair?: string[];
  cancel?: string[];
}

export type Priority = "P1" | "P2" | "P3";
export type RequestStatus = "open" | "dispatched" | "en-route" | "on-site" | "repairing" | "resolved" | "cancelled";

export interface MaintenanceRequest {
  id: string;
  asset: string;
  reason: string;
  priority: Priority;
  origin: "auto" | "manual";
  status: RequestStatus;
  createdT: number;
  engineerId: string | null;
  dispatchedT: number | null;
  path: [number, number][];
  progress: number;
  etaMin: number;
  repairLeftS: number;
  resolvedT: number | null;
}

export type EngineerStatus = "available" | "dispatched" | "walking" | "on-site" | "repairing";

export interface Engineer {
  id: string;
  name: string;
  // "phone" is the engineer carrying the mobile app; the others are simulated crew.
  kind: "phone" | "sim";
  status: EngineerStatus;
  requestId: string | null;
  pos: [number, number];
  autoWalk: boolean;
  lastStepT: number | null;
}
