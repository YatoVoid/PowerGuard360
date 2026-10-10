export type Source = "live" | "sim";

export type TurbineStatus = "running" | "watch" | "tripped" | "offline";

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

export interface Shipment {
  id: string;
  cargo: string;
  carrier: string;
  route: [number, number][];
  progress: number;
  speedKmh: number;
  source: Source;
  lat: number;
  lon: number;
  remainingKm: number;
  etaMin: number;
  arrived: boolean;
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
  shipments: Shipment[];
  predictions: Prediction[];
  events: PlantEvent[];
  history: HistoryPoint[];
  tempHistory: Record<string, number[]>;
  simWear: Record<string, number>;
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
  gps?: { shipmentId: string; lat: number; lon: number } | null;
}
