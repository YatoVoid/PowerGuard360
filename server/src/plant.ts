import { createPlant, step } from "../../web/src/sim/engine.ts";
import type { PlantState, SensorReading, StepInputs } from "../../web/src/types.ts";
import type { Action } from "./protocol.ts";

// Owns the one authoritative plant. Clients queue actions; each tick applies them and advances one second.
export class PlantHost {
  plant: PlantState = createPlant();
  private inputs: Required<Pick<StepInputs, "tripRequests" | "resetRequests" | "newRequests" | "accept" | "walkM" | "autoWalk" | "startRepair" | "cancel">> = this.empty();
  private sensor: SensorReading | null = null;
  private sensorAtMs: number | undefined;

  private empty() {
    return { tripRequests: [], resetRequests: [], newRequests: [], accept: [], walkM: [], autoWalk: [], startRepair: [], cancel: [] };
  }

  apply(a: Action) {
    const q = this.inputs;
    switch (a.type) {
      case "trip": q.tripRequests.push(a.unit); break;
      case "reset": q.resetRequests.push(a.unit); break;
      case "request": q.newRequests.push({ asset: a.asset, reason: a.reason }); break;
      case "cancel": q.cancel.push(a.requestId); break;
      case "accept": q.accept.push({ requestId: a.requestId, engineerId: a.engineerId }); break;
      case "walk": q.walkM.push({ engineerId: a.engineerId, meters: a.meters }); break;
      case "autoWalk": q.autoWalk.push({ engineerId: a.engineerId, on: a.on }); break;
      case "startRepair": q.startRepair.push(a.requestId); break;
    }
  }

  ingest(r: SensorReading, nowMs = Date.now()) {
    this.sensor = r;
    this.sensorAtMs = nowMs;
  }

  // Engineers whose phone is connected right now. Anyone else on the roster acts on their own,
  // so a job sent to the phone role never stalls just because nobody has the app open.
  phonesOnline = new Set<string>();

  // Auto walk the server switched on itself, so it only ever switches off its own, never the person's choice.
  private standInWalk = new Set<string>();

  private standIn() {
    for (const e of this.plant.engineers) {
      if (e.kind !== "phone") continue;
      const online = this.phonesOnline.has(e.id);
      if (online) {
        if (this.standInWalk.has(e.id)) { this.inputs.autoWalk.push({ engineerId: e.id, on: false }); this.standInWalk.delete(e.id); }
        continue;
      }
      if (!e.autoWalk) { this.inputs.autoWalk.push({ engineerId: e.id, on: true }); this.standInWalk.add(e.id); }
      for (const r of this.plant.requests) {
        if (r.engineerId !== e.id) continue;
        if (r.status === "dispatched") this.inputs.accept.push({ requestId: r.id, engineerId: e.id });
        if (r.status === "on-site") this.inputs.startRepair.push(r.id);
      }
    }
  }

  tick(nowMs = Date.now()) {
    this.standIn();
    this.plant = step(this.plant, { ...this.inputs, sensor: this.sensor, sensorAtMs: this.sensorAtMs, nowMs });
    this.inputs = this.empty();
    this.sensor = null;
    return this.plant;
  }
}
