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

  it("replays recorded failures without tripping, and recommends maintenance instead", () => {
    let s = createPlant();
    let tripped = false;
    for (let i = 0; i < 900; i++) { s = step(s); tripped ||= s.turbines.some((x) => x.status === "tripped"); }
    expect(tripped).toBe(false);
    expect(s.recommendations.some((r) => r.status === "pending")).toBe(true);
    expect(s.requests).toHaveLength(0);
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

  it("judges only the current reading and never projects a failure time", () => {
    const worn = { ...rowFeatures(0), type: "M" as const, toolWearMin: 253, torqueNm: 30 };
    const p = forecast("GT-08", worn);
    expect(p.minutesToFailure).toBeNull();
    expect(p.mode).toBeNull();
    expect(p.risk).toBe(Math.round(failureProbability(worn) * 100) / 100);
  });
});

describe("maintenance", () => {
  it("the manager requests maintenance on a recommendation, with their own notes, and the repair resets the tool", () => {
    let s = createPlant();
    for (let i = 0; i < 900 && !s.requests.some((x) => x.asset === "GT-03" && x.status === "resolved"); i++) {
      const rec = s.recommendations.find((x) => x.asset === "GT-03" && x.status === "pending");
      const r = s.requests.find((x) => x.asset === "GT-03" && x.status !== "resolved");
      const inputs: StepInputs = { autoWalk: [{ engineerId: PHONE_ENGINEER, on: true }] };
      if (rec) inputs.review = [{ recommendationId: rec.id, decision: "request", note: "Check the tool holder" }];
      if (r?.status === "open") inputs.dispatch = [{ requestId: r.id, engineerId: PHONE_ENGINEER }];
      if (r?.status === "dispatched") inputs.accept = [{ requestId: r.id, engineerId: PHONE_ENGINEER }];
      if (r?.status === "on-site") inputs.startRepair = [r.id];
      s = step(s, inputs);
    }
    const done = s.requests.find((x) => x.asset === "GT-03")!;
    expect(done).toMatchObject({ status: "resolved", origin: "model", reason: "Check the tool holder" });
    expect(done.basis?.detail).toBeTruthy();
    expect(s.recommendations.find((x) => x.requestId === done.id)!.status).toBe("requested");
    expect(s.turbines[2].status).toBe("running");
  });

  it("nothing is requested or dispatched until the manager acts", () => {
    const s = run(createPlant(), 600);
    expect(s.recommendations.length).toBeGreaterThan(0);
    expect(s.requests).toHaveLength(0);
    expect(s.engineers.every((e) => e.status === "available")).toBe(true);
  });

  it("won't dispatch an engineer who is already on a job", () => {
    let s = step(createPlant(), { newRequests: [{ asset: "GT-02", reason: "" }, { asset: "GT-05", reason: "" }] });
    const [a, b] = ["GT-02", "GT-05"].map((id) => s.requests.find((x) => x.asset === id)!.id);
    s = step(s, { dispatch: [{ requestId: a, engineerId: PHONE_ENGINEER }] });
    s = step(s, { dispatch: [{ requestId: b, engineerId: PHONE_ENGINEER }] });
    expect(s.requests.find((x) => x.id === b)!.status).toBe("open");
  });

  it("an engineer already at the turbine starts there instead of walking out to the road", () => {
    let s = step(createPlant(), { newRequests: [{ asset: "GT-05", reason: "Inspect" }] });
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
    expect(s.requests.find((x) => x.id === again.id)!.status).toBe("repairing");
    expect(s.engineers.find((e) => e.id === PHONE_ENGINEER)!.pos).toEqual(at);
  });

  it("the phone engineer walks only on GPS steps, then the repair fits a new tool", () => {
    let s = run(createPlant(), 5);
    s = step(s, { newRequests: [{ asset: "GT-05", reason: "Inspect" }] });
    const id = s.requests.find((x) => x.asset === "GT-05")!.id;
    s = step(s, { dispatch: [{ requestId: id, engineerId: PHONE_ENGINEER }] });
    s = step(s, { accept: [{ requestId: id, engineerId: PHONE_ENGINEER }] });
    const before = s.requests.find((x) => x.id === id)!.progress;
    s = step(s);
    expect(s.requests.find((x) => x.id === id)!.progress).toBe(before);
    for (let i = 0; i < 200 && s.requests.find((x) => x.id === id)!.status === "en-route"; i++) {
      s = step(s, { walkM: [{ engineerId: PHONE_ENGINEER, meters: 8 }] });
    }
    expect(s.requests.find((x) => x.id === id)!.status).toBe("repairing");
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

  it("a flagged live reading is recommended for maintenance, not tripped", () => {
    const ml = { failureClass: 1 as const, alertLevel: "Critical" as const, threshold: 0.61, types: [{ code: "OSF" as const, name: "Overstrain failure", probability: 0.97 }], factors: null, action: "Reduce load and replace the tool." };
    const s = step(createPlant(), {
      sensor: reading({ type: "L", air_temp_k: 299, process_temp_k: 310, rpm: 1400, torque_nm: 60, tool_wear_min: 200 }),
      sensorAtMs: 1000, nowMs: 1500,
      remote: [{ unit: "GT-08", probability: 0.97, mode: "OSF", detail: "Overstrain failure detected", model: "Random Forest", ml }], remoteAtMs: 1000,
    });
    expect(s.turbines[7].status).toBe("watch");
    expect(s.recommendations.find((r) => r.asset === "GT-08")).toMatchObject({ status: "pending", alertLevel: "Critical", action: "Reduce load and replace the tool." });
  });

  it("a declined unit stays quiet for a while, then can be recommended again", () => {
    const ml = { failureClass: 1 as const, alertLevel: "Alert" as const, threshold: 0.61, types: [], factors: null, action: "Run a general inspection." };
    const flagged = (nowMs: number) => ({ remote: [{ unit: "GT-01", probability: 0.7, mode: null, model: "Random Forest", ml }], remoteAtMs: nowMs, nowMs });
    let s = step(createPlant(), flagged(1000));
    const rec = s.recommendations.find((r) => r.asset === "GT-01")!;
    s = step(s, { ...flagged(2000), review: [{ recommendationId: rec.id, decision: "decline", note: "" }] });
    for (let i = 0; i < 100; i++) s = step(s, flagged(3000 + i * 1000));
    expect(s.recommendations.filter((r) => r.asset === "GT-01")).toHaveLength(1);
    expect(s.requests).toHaveLength(0);
    for (let i = 0; i < 100; i++) s = step(s, flagged(200000 + i * 1000));
    expect(s.recommendations.filter((r) => r.asset === "GT-01" && r.status === "pending")).toHaveLength(1);
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

  it("reports a unit the classifier clears as healthy, with no failure time", () => {
    const remote = [{ unit: "GT-01", probability: 0.02, mode: null, model: "Random Forest", ml: ml(0) }];
    const s = step(createPlant(), { remote, remoteAtMs: 1000, nowMs: 2000 });
    const p = s.predictions.find((x) => x.turbineId === "GT-01")!;
    expect(p).toMatchObject({ by: "Random Forest", probability: 0.02, risk: 0.02, mode: null, minutesToFailure: null });
    expect(s.turbines[0].status).toBe("running");
    expect(s.recommendations).toHaveLength(0);
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

describe("gas metering air quality", () => {
  const air = (raw: number) => ({ device: "b", seq: 1, uptime_ms: 1, readings: { air_quality_raw: raw } });
  const feed = (s: PlantState, raws: number[], startMs: number) => {
    raws.forEach((raw, i) => { s = step(s, { sensor: air(raw), sensorAtMs: startMs + i * 1000, nowMs: startMs + i * 1000 }); });
    return s;
  };

  it("learns clean air, then flags a breath on the sensor as a possible leak", () => {
    let s = feed(createPlant(), Array(10).fill(1600), 1000);
    expect(s.gas).toMatchObject({ connected: true, level: "good", qualityPct: 100 });
    expect(s.recommendations).toHaveLength(0);
    s = feed(s, [3000, 3100], 11000);
    expect(s.gas.level).toBe("poor");
    expect(s.gas.qualityPct).toBeLessThan(60);
    const rec = s.recommendations.find((r) => r.asset === "gas")!;
    expect(rec).toMatchObject({ status: "pending", by: "Air quality sensor" });
    expect(rec.detail).toMatch(/possible gas leak/);
    expect(s.events.some((e) => e.asset === "gas" && /down to/.test(e.text))).toBe(true);
  });

  it("does not learn the leak as clean air", () => {
    let s = feed(createPlant(), Array(10).fill(1600), 1000);
    s = feed(s, Array(60).fill(3000), 11000);
    expect(s.gas.baseline).toBeCloseTo(1600, 0);
    expect(s.gas.level).toBe("poor");
  });

  it("recovers when the air clears and the request goes through the normal flow", () => {
    let s = feed(createPlant(), Array(10).fill(1600), 1000);
    s = feed(s, [3000], 11000);
    const rec = s.recommendations.find((r) => r.asset === "gas")!;
    s = step(s, { sensor: air(1600), sensorAtMs: 12000, nowMs: 12000, review: [{ recommendationId: rec.id, decision: "request", note: "" }] });
    expect(s.gas.level).toBe("good");
    expect(s.requests[0]).toMatchObject({ asset: "gas", origin: "model", reason: rec.action });
  });

  it("shows no sensor once the posts stop", () => {
    let s = feed(createPlant(), Array(10).fill(1600), 1000);
    s = step(s, { nowMs: 40000 });
    expect(s.gas.connected).toBe(false);
  });
});
