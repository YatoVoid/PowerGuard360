import type { FailureMode, MlDiagnosis, PlantState, RemotePrediction } from "../../web/src/types.ts";

// Client for machine_learning/api.py. Once a second the plant server sends every running turbine's
// six readings; the answers replace the decision tree for those units while they stay fresh.

export const MODEL_NAME = "Random Forest";
const TIMEOUT_MS = 4000;

interface ServiceUnit {
  unit: string;
  failure_risk: number;
  failure_class: 0 | 1;
  failure_types: { code: FailureMode; name: string; probability: number }[];
  top_features: MlDiagnosis["factors"];
  alert_level: MlDiagnosis["alertLevel"];
  suggested_action: string;
}
interface ServiceReply { threshold: number; units: ServiceUnit[] }

const UNIT_LABEL: Record<string, string> = {
  "Air temperature [K]": "air temperature", "Process temperature [K]": "process temperature",
  "Rotational speed [rpm]": "speed", "Torque [Nm]": "torque", "Tool wear [min]": "tool wear", Type: "machine type",
};

export function toRemote(u: ServiceUnit, threshold: number, onTrip = false): RemotePrediction {
  const pct = Math.round(u.failure_risk * 100);
  const lead = u.failure_types[0];
  const top = u.top_features?.find((t) => t.contribution > 0);
  const why = top ? `, driven by ${UNIT_LABEL[top.feature] ?? top.feature}` : "";
  const detail = u.failure_class === 1
    ? lead ? `${lead.name} detected (${pct}% risk${why})` : `Failure detected (${pct}% risk${why}), no single failure type above 50%`
    : `${MODEL_NAME} gives ${pct}% failure risk on the current reading${why}`;
  return {
    unit: u.unit,
    probability: u.failure_risk,
    mode: u.failure_class === 1 ? lead?.code ?? null : null,
    minutes_to_failure: null,
    detail,
    model: MODEL_NAME,
    ml: {
      failureClass: u.failure_class,
      alertLevel: u.alert_level,
      threshold,
      types: u.failure_types,
      factors: u.top_features,
      action: u.suggested_action,
      onTrip,
    },
  };
}

export class MlScorer {
  private busy = false;
  private last = "";

  constructor(private url: string, private onResult: (preds: RemotePrediction[]) => void) {}

  score(plant: PlantState) {
    if (this.busy) return;
    // A unit that just tripped is scored once more, on the reading it tripped on, for its diagnosis.
    const tripped = new Set(plant.turbines.filter((t) => t.status === "tripped" && t.tripReading && !t.diagnosis).map((t) => t.id));
    const units = plant.turbines
      .filter((t) => t.status === "running" || t.status === "watch" || tripped.has(t.id))
      .map((t) => {
        const f = tripped.has(t.id) ? t.tripReading! : t.features;
        return {
          unit: t.id,
          features: { type: f.type, air_temp_k: f.airTempK, process_temp_k: f.processTempK, rpm: f.rpm, torque_nm: f.torqueNm, tool_wear_min: f.toolWearMin },
        };
      });
    if (!units.length) return;
    this.busy = true;
    fetch(`${this.url}/score`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ units }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const reply = (await res.json()) as ServiceReply;
        this.onResult(reply.units.map((u) => toRemote(u, reply.threshold, tripped.has(u.unit))));
        this.status(true);
      })
      .catch((e: Error) => this.status(false, e))
      .finally(() => { this.busy = false; });
  }

  // Logs only when the service comes or goes, not every second.
  private status(ok: boolean, e?: Error) {
    const msg = ok ? `[ml] scoring every turbine with ${MODEL_NAME} at ${this.url}`
      : `[ml] ${this.url} unavailable (${e?.cause instanceof Error ? e.cause.message : e?.message}); the decision tree takes over after 15 s`;
    if (msg === this.last) return;
    this.last = msg;
    if (ok) console.log(msg);
    else console.warn(msg);
  }
}
