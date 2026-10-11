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
  // Dataset row being replayed. GT-08 keeps replaying underneath the board so anything it doesn't send still has a value.
  row: number | null;
  // Readings measured by the sensor board right now; the rest come from the dataset row.
  measured: (keyof Features)[];
  // The machine_learning service's verdict on the reading the unit tripped on, kept until it runs again.
  diagnosis?: MlDiagnosis | null;
  // The reading at the moment of the trip. A live unit's readings keep moving, so this is what gets diagnosed.
  tripReading?: Features | null;
}

export interface Board {
  source: Source;
  lastSeenMs: number | null;
  // Only what the board sent in its latest post.
  features: Partial<Features> | null;
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
  // Which model produced it: the on-board decision tree, or the name the ML laptop posts.
  by: string;
  ml?: MlDiagnosis;
}

// What the machine_learning service adds on top of a probability: Model 2's failure types,
// the SHAP inputs that moved the risk most, and the rule-based alert level and action.
export interface MlDiagnosis {
  failureClass: 0 | 1;
  alertLevel: "Normal" | "Watch" | "Alert" | "Critical";
  threshold: number;
  types: { code: FailureMode; name: string; probability: number }[];
  factors: { feature: string; value: number | string; contribution: number; direction: string }[] | null;
  action: string;
  // Scored on the reading the unit tripped on.
  onTrip?: boolean;
}

// What the ML laptop posts after scoring the sensor board's readings.
export interface RemotePrediction {
  unit: string;
  probability: number;
  mode?: FailureMode | null;
  minutes_to_failure?: number | null;
  detail?: string;
  model?: string;
  ml?: MlDiagnosis;
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
  recommendations: Recommendation[];
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
  // Model forecasts by unit: the machine_learning service for every turbine, and the ML laptop's post.
  remote?: RemotePrediction | RemotePrediction[] | null;
  remoteAtMs?: number;
  nowMs?: number;
  tripRequests?: string[];
  resetRequests?: string[];
  // Maintenance: manual requests from the manager, and the phone engineer's actions.
  newRequests?: { asset: string; reason: string }[];
  dispatch?: { requestId: string; engineerId: string }[];
  // The manager's answer to a recommendation: request maintenance with notes on what to check, or decline.
  review?: { recommendationId: string; decision: "request" | "decline"; note: string }[];
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
  // "model" = the manager accepted a model recommendation; "manual" = raised by the manager directly.
  origin: "model" | "manual";
  // Why the model flagged it, carried onto the job so the engineer sees it next to the manager's notes.
  basis?: { risk: number; types: string[]; detail: string } | null;
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

export type RecommendationStatus = "pending" | "requested" | "declined";

// The model thinks a unit needs maintenance. Nothing happens until the manager requests or declines it.
export interface Recommendation {
  id: string;
  asset: string;
  createdT: number;
  updatedT: number;
  risk: number;
  alertLevel: MlDiagnosis["alertLevel"];
  detail: string;
  by: string;
  types: { code: FailureMode; name: string; probability: number }[];
  factors: MlDiagnosis["factors"];
  action: string;
  status: RecommendationStatus;
  decidedT: number | null;
  requestId: string | null;
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
