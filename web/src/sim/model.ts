import data from "../data/ai4i.json";
import model from "../data/model.json";
import type { FailureMode, Features, MachineType } from "../types";

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

const TYPES: MachineType[] = ["L", "M", "H"];
// [type, airK, processK, rpm, torque, wearMin, fail, TWF, HDF, PWF, OSF, RNF]
type Row = number[];
export const ROWS = data.rows as Row[];
export const WINDOWS = data.windows as [number, number][];
export const MODEL_METRICS = model.metrics;
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
