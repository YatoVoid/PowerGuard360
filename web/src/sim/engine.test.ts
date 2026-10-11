import { describe, expect, it } from "vitest";
import { createPlant, forecast, PHONE_ENGINEER, REPAIR_S, ROW_SECONDS, step } from "./engine";
import { assetPath, pathLength, routeFrom } from "./site";
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
      if (r && r.status === "open") s = step(s, { dispatch: [{ requestId: r.id, engineerId: PHONE_ENGINEER }] });
      if (r && r.status === "dispatched" && r.engineerId === PHONE_ENGINEER) s = step(s, { accept: [{ requestId: r.id, engineerId: PHONE_ENGINEER }] });
      if (r && r.status === "on-site" && r.engineerId === PHONE_ENGINEER) s = step(s, { startRepair: [r.id] });
    }
    expect(raisedAt).toBeGreaterThan(0);
    expect(s.events.some((e) => e.asset === "GT-03" && e.severity === "trip")).toBe(false);
    expect(s.requests.some((x) => x.asset === "GT-03" && x.status === "resolved")).toBe(true);
  });

  it("a trip raises a P1 that waits for the manager to dispatch someone", () => {
    let s = run(createPlant(), 5);
    s = step(s, { tripRequests: ["GT-05"] });
    s = run(s, 30);
    const r = s.requests.find((x) => x.asset === "GT-05")!;
    expect(r.priority).toBe("P1");
    expect(r.status).toBe("open");
    expect(r.engineerId).toBeNull();
    expect(s.engineers.every((e) => e.status === "available")).toBe(true);
    s = step(s, { dispatch: [{ requestId: r.id, engineerId: PHONE_ENGINEER }] });
    expect(s.requests.find((x) => x.id === r.id)).toMatchObject({ status: "dispatched", engineerId: PHONE_ENGINEER });
  });

  it("won't dispatch an engineer who is already on a job", () => {
    let s = step(createPlant(), { tripRequests: ["GT-02", "GT-05"] });
    s = step(s);
    const [a, b] = ["GT-02", "GT-05"].map((id) => s.requests.find((x) => x.asset === id)!.id);
    s = step(s, { dispatch: [{ requestId: a, engineerId: PHONE_ENGINEER }] });
    s = step(s, { dispatch: [{ requestId: b, engineerId: PHONE_ENGINEER }] });
    expect(s.requests.find((x) => x.id === b)!.status).toBe("open");
  });

  it("an engineer already at the turbine starts there instead of walking out to the road", () => {
    let s = step(createPlant(), { tripRequests: ["GT-05"] });
    s = step(s);
    const first = s.requests.find((x) => x.asset === "GT-05")!.id;
    s = step(s, { dispatch: [{ requestId: first, engineerId: PHONE_ENGINEER }], autoWalk: [{ engineerId: PHONE_ENGINEER, on: true }] });
    s = step(s, { accept: [{ requestId: first, engineerId: PHONE_ENGINEER }] });
    for (let i = 0; i < 200 && s.requests.find((x) => x.id === first)!.status !== "on-site"; i++) s = step(s);
    s = step(s, { startRepair: [first] });
    for (let i = 0; i <= REPAIR_S; i++) s = step(s);
    const at = s.engineers.find((e) => e.id === PHONE_ENGINEER)!.pos;
    s = step(s, { newRequests: [{ asset: "GT-05", reason: "Check again" }] });
    const again = s.requests.find((x) => x.asset === "GT-05" && x.status === "open")!;
    s = step(s, { dispatch: [{ requestId: again.id, engineerId: PHONE_ENGINEER }] });
    expect(pathLength(s.requests.find((x) => x.id === again.id)!.path)).toBeLessThan(1);
    s = step(s, { accept: [{ requestId: again.id, engineerId: PHONE_ENGINEER }] });
    s = step(s);
    expect(s.requests.find((x) => x.id === again.id)!.status).toBe("on-site");
    expect(s.engineers.find((e) => e.id === PHONE_ENGINEER)!.pos).toEqual(at);
  });

  it("the phone engineer walks only on GPS steps, then the repair fits a new tool", () => {
    let s = run(createPlant(), 5);
    s = step(s, { tripRequests: ["GT-05"] });
    s = step(s);
    const id = s.requests.find((x) => x.asset === "GT-05")!.id;
    s = step(s, { dispatch: [{ requestId: id, engineerId: PHONE_ENGINEER }] });
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
    const crew = s.engineers.find((e) => e.kind === "sim")!.id;
    s = step(s, { dispatch: [{ requestId: r.id, engineerId: crew }] });
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
    expect(gt8.measured).toHaveLength(5);
    expect(gt8.features).toMatchObject({ type: "M", rpm: 1500, torqueNm: 42 });
  });

  it("uses what a partial reading sends and replays the dataset for the rest", () => {
    const before = createPlant();
    const s = step(before, { sensor: reading({ type: "M", air_temp_k: 297.4, process_temp_k: 303.8, tool_wear_min: 6 }), sensorAtMs: 1000, nowMs: 1500 });
    const gt8 = s.turbines[7];
    expect(gt8.source).toBe("live");
    expect(gt8.measured.sort()).toEqual(["airTempK", "processTempK", "toolWearMin"]);
    expect(gt8.features).toMatchObject({ airTempK: 297.4, processTempK: 303.8, toolWearMin: 6 });
    expect(gt8.features.rpm).toBe(before.turbines[7].features.rpm);
    expect(s.board.features).toEqual({ type: "M", airTempK: 297.4, processTempK: 303.8, toolWearMin: 6 });
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

describe("ML laptop forecast", () => {
  const remote = { unit: "GT-08", probability: 0.8, mode: "HDF" as const, minutes_to_failure: 1.5, model: "LSTM v2" };

  it("replaces the tree's forecast for its unit while fresh", () => {
    const s = step(createPlant(), { remote, remoteAtMs: 1000, nowMs: 2000 });
    const p = s.predictions.find((x) => x.turbineId === "GT-08")!;
    expect(p).toMatchObject({ by: "LSTM v2", probability: 0.8, mode: "HDF", minutesToFailure: 1.5 });
    expect(s.turbines[7].status).toBe("watch");
    expect(s.predictions.find((x) => x.turbineId === "GT-01")!.by).toBe("Decision tree");
  });

  it("falls back to the tree once the laptop stops posting", () => {
    const s = step(createPlant(), { remote, remoteAtMs: 1000, nowMs: 30000 });
    expect(s.predictions.find((x) => x.turbineId === "GT-08")!.by).toBe("Decision tree");
  });
});

describe("machine_learning service forecast", () => {
  const ml = (failureClass: 0 | 1) => ({
    failureClass, alertLevel: failureClass ? "Critical" as const : "Normal" as const, threshold: 0.61,
    types: failureClass ? [{ code: "HDF" as const, name: "Heat dissipation failure", probability: 0.91 }] : [],
    factors: null, action: failureClass ? "Inspect cooling." : "No action.",
  });

  it("scores every unit it is given and keeps the diagnosis", () => {
    const remote = [
      { unit: "GT-01", probability: 0.96, mode: "HDF" as const, detail: "Heat dissipation failure detected", model: "Random Forest", ml: ml(1) },
      { unit: "GT-02", probability: 0.01, mode: null, model: "Random Forest", ml: ml(0) },
    ];
    const s = step(createPlant(), { remote, remoteAtMs: 1000, nowMs: 2000 });
    const p1 = s.predictions.find((x) => x.turbineId === "GT-01")!;
    expect(p1).toMatchObject({ by: "Random Forest", mode: "HDF", risk: 0.96, detail: "Heat dissipation failure detected" });
    expect(p1.ml?.action).toBe("Inspect cooling.");
    expect(s.turbines[0].status).toBe("watch");
    expect(s.predictions.find((x) => x.turbineId === "GT-02")!.by).toBe("Random Forest");
    expect(s.predictions.find((x) => x.turbineId === "GT-03")!.by).toBe("Decision tree");
  });

  it("still forecasts tool wear when the classifier sees no failure", () => {
    let s = createPlant();
    let i = 0;
    for (; i < 3000 && forecast("GT-01", s.turbines[0].features).minutesToFailure === null; i++) s = step(s, {});
    const remote = [{ unit: "GT-01", probability: 0.02, mode: null, model: "Random Forest", ml: ml(0) }];
    s = step(s, { remote, remoteAtMs: 1000, nowMs: 2000 });
    const tree = forecast("GT-01", s.turbines[0].features);
    const p = s.predictions.find((x) => x.turbineId === "GT-01")!;
    expect(tree.minutesToFailure).not.toBeNull();
    expect(p).toMatchObject({ by: "Random Forest", probability: 0.02, mode: tree.mode, minutesToFailure: tree.minutesToFailure });
  });
});

describe("site routes", () => {
  const stand = (asset: string) => assetPath(asset).at(-1)!;

  it("from the control room follows the asset's own path", () => {
    expect(routeFrom(assetPath("GT-03")[0], "GT-03")).toEqual(assetPath("GT-03"));
  });

  it("is empty when the engineer is already at the asset", () => {
    expect(pathLength(routeFrom(stand("GT-04"), "GT-04"))).toBe(0);
  });

  it("from one turbine to another goes back down its own lane, along the road and up the other lane", () => {
    const route = routeFrom(stand("GT-02"), "GT-06");
    const lane2 = assetPath("GT-02")[3][0], lane6 = assetPath("GT-06")[3][0];
    expect(route[1]).toEqual([lane2, -48]);
    expect(route[2]).toEqual([lane2, 38]);
    expect(route[3]).toEqual([lane6, 38]);
    expect(route.at(-1)).toEqual(stand("GT-06"));
  });

  it("joins the target's path where the engineer already stands on it", () => {
    const lane = assetPath("GT-03")[3];
    const midLane: [number, number] = [lane[0], -10];
    expect(routeFrom(midLane, "GT-03")).toEqual([midLane, lane, stand("GT-03")]);
  });
});
