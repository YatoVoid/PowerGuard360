import data from "../data/ai4i.json";
import model from "../data/model.json";
import type { FailureMode, Features, MachineType, PlantState } from "../types";

// Limits taken from how the AI4I 2020 dataset generates each failure mode.
export const OSF_LIMIT: Record<MachineType, number> = { L: 11000, M: 12000, H: 13000 };
export const HDF_GAP_K = 8.6;
export const HDF_RPM = 1380;
export const PWF_MIN_W = 3500;
export const PWF_MAX_W = 9000;
export const TWF_WEAR_MIN = 200;

export const FAILURE_NAME: Record<FailureMode, string> = {
  TWF: "Tool wear failure",
  HDF: "Heat dissipation failure",
  PWF: "Power failure",
  OSF: "Overstrain failure",
  RNF: "Random failure",
};

// Same wording as machine_learning/src/maintenance.py, so a tripped unit still tells the engineer what to check
// after it drops out of the model's scoring.
export const FAILURE_ACTION: Partial<Record<FailureMode, string>> = {
  TWF: "Replace the worn tool and reset the tool-wear counter.",
  HDF: "Inspect cooling: fans, airflow and heat exchangers. The process/air temperature gap is too small.",
  PWF: "Inspect motor and power supply. Power draw is outside the safe operating window.",
  OSF: "Reduce load and replace the tool. Torque on a worn tool is overstraining the equipment.",
};

// What an engineer sent to this asset should check: the model's action while it is flagging the unit,
// otherwise the action for the failure it tripped on or is forecast to have.
export function whatToCheck(plant: PlantState, asset: string): string | null {
  const pred = plant.predictions.find((p) => p.turbineId === asset);
  const diag = plant.turbines.find((t) => t.id === asset)?.diagnosis;
  if (diag?.failureClass && diag.types.length) return diag.action;
  if (pred?.ml && (pred.ml.alertLevel === "Alert" || pred.ml.alertLevel === "Critical")) return pred.ml.action;
  const cause = plant.turbines.find((t) => t.id === asset)?.tripCause;
  const tripped = (Object.keys(FAILURE_NAME) as FailureMode[]).find((m) => FAILURE_NAME[m] === cause);
  const mode = tripped ?? pred?.mode ?? null;
  return (mode && FAILURE_ACTION[mode]) ?? null;
}

const TYPES: MachineType[] = ["L", "M", "H"];
// [type, airK, processK, rpm, torque, wearMin, fail, TWF, HDF, PWF, OSF, RNF]
type Row = number[];
export const ROWS = data.rows as Row[];
export const WINDOWS = data.windows as [number, number][];
export const MODEL_METRICS = model.metrics;

// Held-out test results of the machine_learning service (machine_learning/reports/metrics.json).
export const ML_METRICS = { train_rows: 8000, test_rows: 2000, recall: 0.779, precision: 0.964, false_alerts: 2, type_macro_f1: 0.93 };

// One line on whichever model is producing the forecasts right now.
export function modelNote(usingService: boolean) {
  return usingService
    ? `Random Forest trained on ${ML_METRICS.train_rows.toLocaleString("en-US")} rows of the AI4I 2020 dataset. On ${ML_METRICS.test_rows.toLocaleString("en-US")} rows it never saw, it caught ${Math.round(ML_METRICS.recall * 100)}% of failures at ${Math.round(ML_METRICS.precision * 100)}% precision (${ML_METRICS.false_alerts} false alerts), and a second Random Forest named the failure type with ${ML_METRICS.type_macro_f1} macro-F1. Tool wear projections cover the failures it can't see coming.`
    : `Decision tree trained on ${MODEL_METRICS.train_rows.toLocaleString("en-US")} rows of the AI4I 2020 dataset. On ${MODEL_METRICS.test_rows.toLocaleString("en-US")} rows it never saw, it caught ${Math.round(MODEL_METRICS.recall * 100)}% of failures at ${Math.round(MODEL_METRICS.precision * 100)}% precision. Tool wear projections cover the failures it can't see coming.`;
}
export const DATA_SOURCE = data.source;

export function rowFeatures(i: number): Features {
  const r = ROWS[i];
  return { type: TYPES[r[0]], airTempK: r[1], processTempK: r[2], rpm: r[3], torqueNm: r[4], toolWearMin: r[5] };
}

export function rowFailure(i: number): FailureMode | null {
  const r = ROWS[i];
  if (!r[6]) return null;
  const modes: FailureMode[] = ["TWF", "HDF", "PWF", "OSF", "RNF"];
  return modes.find((_, k) => r[7 + k] === 1) ?? "RNF";
}

export function shaftPowerW(f: Features) {
  return (f.torqueNm * f.rpm * 2 * Math.PI) / 60;
}

// Same feature order as data/prepare.py.
function vector(f: Features) {
  const t = TYPES.indexOf(f.type);
  const strain = f.toolWearMin * f.torqueNm;
  return [t, f.airTempK, f.processTempK, f.rpm, f.torqueNm, f.toolWearMin, shaftPowerW(f), f.processTempK - f.airTempK, strain, strain / OSF_LIMIT[f.type]];
}

// Walks the exported scikit-learn tree: left when the feature is at or below the threshold.
export function failureProbability(f: Features) {
  const x = vector(f);
  const nodes = model.nodes as [number, number, number, number, number][];
  let i = 0;
  for (let guard = 0; guard < 64; guard++) {
    const [feature, threshold, left, right, prob] = nodes[i];
    if (left === -1) return prob;
    i = x[feature] <= threshold ? left : right;
  }
  return 0;
}

// Share of rows past 200 min of tool wear that the dataset labels as tool wear failures.
export const TWF_PER_ROW = (() => {
  let late = 0, twf = 0;
  for (const r of ROWS) if (r[5] >= TWF_WEAR_MIN && r[5] <= 240) { late++; if (r[7]) twf++; }
  return late ? twf / late : 0;
})();
