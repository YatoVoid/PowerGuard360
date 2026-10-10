export type Source = "live" | "sim";

export type TurbineStatus = "running" | "watch" | "tripped" | "offline";

export type MachineType = "L" | "M" | "H";
export type FailureMode = "TWF" | "HDF" | "PWF" | "OSF" | "RNF";

// The six input features of the AI4I 2020 dataset, in its own units.
export interface Features {
  type: MachineType;
  airTempK: number;
  processTempK: number;
  rpm: number;
  torqueNm: number;
  toolWearMin: number;
}

export interface Turbine {
  id: string;
  status: TurbineStatus;
  tripCause: string | null;
  outputMw: number;
  capacityMw: number;
  ratedMw: number;
  features: Features;
  // Mechanical power from torque and speed, the quantity the dataset's power-failure rule uses.
  shaftPowerKw: number;
  // "live" when the features come from the sensor board, "sim" when replayed from the dataset.
  source: Source;
  // Dataset row being replayed, or null while live.
  row: number | null;
}

export interface Board {
  source: Source;
  lastSeenMs: number | null;
  features: Features | null;
}

export interface Battery {
  socPct: number;
  powerMw: number;
  capacityMwh: number;
  maxPowerMw: number;
}

export interface Prediction {
  turbineId: string;
  // Failure probability from the decision tree on the current row.
  probability: number;
  mode: FailureMode | null;
  minutesToFailure: number | null;
  risk: number;
  detail: string;
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
  board: Board;
  engineers: Engineer[];
  requests: MaintenanceRequest[];
  predictions: Prediction[];
  events: PlantEvent[];
  history: HistoryPoint[];
  riskHistory: Record<string, number[]>;
}

// What the sensor board posts: the dataset's six features, measured live for GT-08.
export interface SensorReading {
  device: string;
  seq: number;
  uptime_ms: number;
  readings: {
    type?: MachineType;
    air_temp_k?: number;
    process_temp_k?: number;
    rpm?: number;
    torque_nm?: number;
    tool_wear_min?: number;
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
