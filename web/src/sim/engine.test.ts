import { describe, expect, it } from "vitest";
import { createPlant, forecast, PHONE_ENGINEER, REPAIR_S, ROW_SECONDS, step } from "./engine";
import { MODEL_METRICS, ROWS, WINDOWS, failureProbability, rowFailure, rowFeatures } from "./model";
import type { PlantState, StepInputs } from "../types";

function run(state: PlantState, seconds: number, inputs: StepInputs = {}) {
  let s = state;
  for (let i = 0; i < seconds; i++) s = step(s, inputs);
  return s;
}

describe("dataset replay", () => {
  it("loads all 10,000 rows of the AI4I dataset", () => {
    expect(ROWS.length).toBe(10000);
    expect(WINDOWS.length).toBe(8);
  });

  it("each unit shows the exact features of the dataset row it is on", () => {
    const s = run(createPlant(), ROW_SECONDS * 3);
    for (const tb of s.turbines) expect(tb.features).toEqual(rowFeatures(tb.row!));
  });

  it("GT-03's tool life ends in the overstrain failure the dataset records", () => {
    const [, end] = WINDOWS[2];
    expect(rowFailure(end - 1)).toBe("OSF");
  });

  it("the other units replay tool lives with no recorded failure", () => {
    for (const [i, [start, end]] of WINDOWS.entries()) {
      if (i === 2) continue;
      for (let r = start; r < end; r++) expect(rowFailure(r)).toBeNull();
    }
  });

  it("a unit trips exactly when it reaches a failure row and nobody intervenes", () => {
    let s = createPlant();
    for (let i = 0; i < 900 && s.turbines[2].status !== "tripped"; i++) {
      s = step(s, { cancel: s.requests.filter((r) => r.asset === "GT-03" && r.status !== "cancelled").map((r) => r.id) });
    }
    expect(s.turbines[2].status).toBe("tripped");
    expect(s.turbines[2].tripCause).toBe("Overstrain failure");
  });
});

describe("model", () => {
  it("scores well on rows it never saw in training", () => {
    expect(MODEL_METRICS.precision).toBeGreaterThan(0.9);
    expect(MODEL_METRICS.recall).toBeGreaterThan(0.7);
  });

  it("flags a heat dissipation failure row and clears a healthy one", () => {
    const hdf = ROWS.findIndex((r) => r[8] === 1);
    expect(failureProbability(rowFeatures(hdf))).toBeGreaterThan(0.5);
    expect(failureProbability(rowFeatures(0))).toBeLessThan(0.2);
  });

  it("forecasts overstrain sooner as tool wear rises", () => {
    const f = rowFeatures(0);
    const early = forecast("GT-01", { ...f, toolWearMin: 60 });
    const late = forecast("GT-01", { ...f, toolWearMin: 190 });
    expect(late.minutesToFailure!).toBeLessThan(early.minutesToFailure ?? Infinity);
  });
});

describe("maintenance", () => {
  it("raises a request for GT-03 before its overstrain failure, and the repair prevents it", () => {
    let s = createPlant();
    let raisedAt = -1;
    for (let i = 0; i < 600; i++) {
      s = step(s, { autoWalk: [{ engineerId: PHONE_ENGINEER, on: true }] });
      const r = s.requests.find((x) => x.asset === "GT-03");
      if (r && raisedAt < 0) raisedAt = s.t;
      if (r && r.status === "dispatched" && r.engineerId === PHONE_ENGINEER) s = step(s, { accept: [{ requestId: r.id, engineerId: PHONE_ENGINEER }] });
      if (r && r.status === "on-site" && r.engineerId === PHONE_ENGINEER) s = step(s, { startRepair: [r.id] });
    }
    expect(raisedAt).toBeGreaterThan(0);
    expect(s.events.some((e) => e.asset === "GT-03" && e.severity === "trip")).toBe(false);
    expect(s.requests.some((x) => x.asset === "GT-03" && x.status === "resolved")).toBe(true);
  });

  it("a trip raises a P1 and dispatches the phone engineer first", () => {
    let s = run(createPlant(), 5);
    s = step(s, { tripRequests: ["GT-05"] });
    s = step(s);
    const r = s.requests.find((x) => x.asset === "GT-05")!;
    expect(r.priority).toBe("P1");
    expect(r.engineerId).toBe(PHONE_ENGINEER);
  });

  it("the phone engineer walks only on GPS steps, then the repair fits a new tool", () => {
    let s = run(createPlant(), 5);
    s = step(s, { tripRequests: ["GT-05"] });
    s = step(s);
    const id = s.requests.find((x) => x.asset === "GT-05")!.id;
    s = step(s, { accept: [{ requestId: id, engineerId: PHONE_ENGINEER }] });
    const before = s.requests.find((x) => x.id === id)!.progress;
    s = step(s);
    expect(s.requests.find((x) => x.id === id)!.progress).toBe(before);
    for (let i = 0; i < 200 && s.requests.find((x) => x.id === id)!.status === "en-route"; i++) {
      s = step(s, { walkM: [{ engineerId: PHONE_ENGINEER, meters: 8 }] });
    }
    s = step(s, { startRepair: [id] });
    for (let i = 0; i < REPAIR_S; i++) s = step(s);
    expect(s.requests.find((x) => x.id === id)!.status).toBe("resolved");
    expect(s.turbines[4].status).toBe("running");
    expect(s.turbines[4].row).toBe(WINDOWS[4][0]);
  });

  it("a manual request goes to an engineer and simulated crew finish it", () => {
    let s = createPlant();
    s = step(s, { tripRequests: ["GT-02"] });
    s = step(s);
    s = step(s, { newRequests: [{ asset: "switchyard", reason: "Breaker 4 alarm" }] });
    const r = s.requests.find((x) => x.asset === "switchyard")!;
    expect(r.origin).toBe("manual");
    for (let i = 0; i < 300 && s.requests.find((x) => x.id === r.id)!.status !== "resolved"; i++) s = step(s);
    expect(s.requests.find((x) => x.id === r.id)!.status).toBe("resolved");
  });

  it("does not open a second request for an asset that already has one", () => {
    let s = createPlant();
    s = step(s, { newRequests: [{ asset: "GT-01", reason: "a" }] });
    s = step(s, { newRequests: [{ asset: "GT-01", reason: "b" }] });
    expect(s.requests.filter((x) => x.asset === "GT-01").length).toBe(1);
  });
});

describe("GT-08 live sensor board", () => {
  const reading = (r: Record<string, number | string>) => ({ device: "board", seq: 1, uptime_ms: 1, readings: r });

  it("takes the six features live and stops replaying the dataset", () => {
    const s = step(createPlant(), {
      sensor: reading({ type: "M", air_temp_k: 299, process_temp_k: 309.5, rpm: 1500, torque_nm: 42, tool_wear_min: 30 }),
      sensorAtMs: 1000, nowMs: 1500,
    });
    const gt8 = s.turbines[7];
    expect(gt8.source).toBe("live");
    expect(gt8.row).toBeNull();
    expect(gt8.features).toMatchObject({ type: "M", rpm: 1500, torqueNm: 42 });
  });

  it("trips on live readings that break the dataset's overstrain rule", () => {
    const s = step(createPlant(), {
      sensor: reading({ type: "L", air_temp_k: 299, process_temp_k: 310, rpm: 1400, torque_nm: 60, tool_wear_min: 200 }),
      sensorAtMs: 1000, nowMs: 1500,
    });
    expect(s.turbines[7].status).toBe("tripped");
    expect(s.turbines[7].tripCause).toBe("Overstrain failure");
  });

  it("ignores stale readings", () => {
    const s = step(createPlant(), {
      sensor: reading({ type: "L", air_temp_k: 299, process_temp_k: 310, rpm: 1400, torque_nm: 60, tool_wear_min: 200 }),
      sensorAtMs: 1000, nowMs: 20000,
    });
    expect(s.turbines[7].source).toBe("sim");
  });
});
