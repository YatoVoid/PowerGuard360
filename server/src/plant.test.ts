import { describe, expect, it } from "vitest";
import { PlantHost } from "./plant.ts";
import { MlScorer, toRemote } from "./ml.ts";
import { ClientMessage, RemotePrediction, SensorReading, dropBadReadings } from "./protocol.ts";

describe("plant host", () => {
  it("applies queued actions on the next tick", () => {
    const h = new PlantHost();
    h.tick();
    h.apply({ type: "trip", unit: "GT-02" });
    h.tick();
    expect(h.plant.turbines[1].status).toBe("tripped");
  });

  it("routes the board's six readings to GT-08 as live", () => {
    const h = new PlantHost();
    h.ingest({ device: "esp32", seq: 1, uptime_ms: 10, readings: { type: "M", air_temp_k: 299, process_temp_k: 309.4, rpm: 1500, torque_nm: 41, tool_wear_min: 20 } }, 1000);
    h.tick(1200);
    expect(h.plant.turbines[7].source).toBe("live");
    expect(h.plant.turbines[7].features.rpm).toBe(1500);
  });
});

describe("phone stand-in", () => {
  it("handles the phone engineer's job when no phone is connected", () => {
    const h = new PlantHost();
    h.tick();
    h.apply({ type: "request", asset: "GT-04", reason: "Inspect" });
    h.tick();
    h.apply({ type: "dispatch", requestId: h.plant.requests[0].id, engineerId: "ENG-1" });
    for (let i = 0; i < 600 && !h.plant.requests.some((r) => r.status === "resolved"); i++) h.tick();
    expect(h.plant.requests[0].engineerId).toBe("ENG-1");
    expect(h.plant.requests[0].status).toBe("resolved");
  });

  it("waits for the person once their phone is connected", () => {
    const h = new PlantHost();
    h.phonesOnline.add("ENG-1");
    h.tick();
    h.apply({ type: "request", asset: "GT-04", reason: "Inspect" });
    h.tick();
    h.apply({ type: "dispatch", requestId: h.plant.requests[0].id, engineerId: "ENG-1" });
    for (let i = 0; i < 30; i++) h.tick();
    expect(h.plant.requests[0].status).toBe("dispatched");
  });
});

describe("auto walk", () => {
  it("keeps the person's own auto walk on while their phone is connected", () => {
    const h = new PlantHost();
    h.phonesOnline.add("ENG-1");
    h.apply({ type: "autoWalk", engineerId: "ENG-1", on: true });
    for (let i = 0; i < 3; i++) h.tick();
    expect(h.plant.engineers[0].autoWalk).toBe(true);
  });
});

describe("dispatch", () => {
  it("leaves requests open until the manager dispatches one", () => {
    const h = new PlantHost();
    h.tick();
    h.apply({ type: "request", asset: "GT-04", reason: "Inspect" });
    for (let i = 0; i < 60; i++) h.tick();
    expect(h.plant.requests[0].status).toBe("open");
    expect(ClientMessage.safeParse({ type: "action", action: { type: "dispatch", requestId: "MR-101", engineerId: "ENG-2" } }).success).toBe(true);
  });
});

describe("recommendations", () => {
  it("turn into a request only when the manager asks, with their notes", () => {
    const h = new PlantHost();
    h.scored([toRemote({
      unit: "GT-06", failure_risk: 0.9, failure_class: 1, failure_types: [{ code: "HDF", name: "Heat dissipation failure", probability: 0.9 }],
      top_features: null, alert_level: "Critical", suggested_action: "Inspect cooling.",
    }, 0.61)], 1000);
    h.tick(2000);
    const rec = h.plant.recommendations.find((r) => r.asset === "GT-06")!;
    expect(rec.status).toBe("pending");
    expect(h.plant.requests).toHaveLength(0);
    const msg = ClientMessage.safeParse({ type: "action", action: { type: "review", recommendationId: rec.id, decision: "request", note: "Check fan 2 bearings" } });
    expect(msg.success).toBe(true);
    if (msg.success && msg.data.type === "action") h.apply(msg.data.action);
    h.tick(3000);
    expect(h.plant.requests[0]).toMatchObject({ asset: "GT-06", reason: "Check fan 2 bearings", priority: "P1", origin: "model", status: "open" });
  });
});

describe("protocol", () => {
  it("rejects actions it does not know", () => {
    expect(ClientMessage.safeParse({ type: "action", action: { type: "explode" } }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: "action", action: { type: "trip", unit: "GT-99" } }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: "action", action: { type: "walk", engineerId: "ENG-1", meters: 500 } }).success).toBe(false);
  });

  it("accepts the documented sensor format and rejects impossible values", () => {
    expect(SensorReading.safeParse({ device: "d", seq: 1, uptime_ms: 1, readings: { air_temp_k: 300, rpm: 1500 } }).success).toBe(true);
    expect(SensorReading.safeParse({ device: "d", seq: 1, uptime_ms: 1, readings: { air_temp_k: 5 } }).success).toBe(false);
    expect(SensorReading.safeParse({ device: "d", seq: 1, uptime_ms: 1, readings: { type: "X" } }).success).toBe(false);
  });
});

describe("ML laptop forecast", () => {
  it("accepts a forecast for a turbine and rejects anything else", () => {
    expect(RemotePrediction.safeParse({ unit: "GT-08", probability: 0.4, mode: "OSF", minutes_to_failure: 3 }).success).toBe(true);
    expect(RemotePrediction.safeParse({ unit: "battery", probability: 0.4 }).success).toBe(false);
    expect(RemotePrediction.safeParse({ unit: "GT-08", probability: 1.4 }).success).toBe(false);
    expect(RemotePrediction.safeParse({ unit: "GT-08", probability: 0.4, detail: "<script>" }).success).toBe(false);
  });

  it("shows the posted forecast on the next tick", () => {
    const h = new PlantHost();
    h.predict({ unit: "GT-08", probability: 0.7, mode: "PWF", model: "Team model" }, 1000);
    h.tick(1500);
    expect(h.plant.predictions.find((p) => p.turbineId === "GT-08")!.by).toBe("Team model");
  });
});

describe("sensor glitches", () => {
  it("drops only the reading that is out of range and keeps the rest of the post", () => {
    const { json, dropped } = dropBadReadings({ device: "b", seq: 1, uptime_ms: 1, readings: { type: "M", air_temp_k: 571.2, process_temp_k: 308.9, rpm: Number.NaN } });
    expect(dropped).toEqual(["air_temp_k=571.2", "rpm=null"]);
    const parsed = SensorReading.safeParse(json);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.readings).toEqual({ type: "M", process_temp_k: 308.9 });
  });
});

describe("machine_learning service", () => {
  const unit = (id: string, risk: number, cls: 0 | 1) => ({
    unit: id, failure_risk: risk, failure_class: cls,
    failure_types: cls ? [{ code: "PWF" as const, name: "Power failure", probability: 0.88 }] : [],
    top_features: [{ feature: "Torque [Nm]", value: 68.1, contribution: 0.52, direction: "increased risk" }],
    alert_level: cls ? "Critical" as const : "Normal" as const,
    suggested_action: cls ? "Inspect motor and power supply." : "No action.",
  });

  it("turns a flagged unit into a diagnosis with its cause", () => {
    const r = toRemote(unit("GT-03", 0.93, 1), 0.61);
    expect(r).toMatchObject({ unit: "GT-03", probability: 0.93, mode: "PWF", model: "Random Forest" });
    expect(r.detail).toBe("Power failure detected (93% risk, driven by torque)");
    expect(r.ml?.action).toBe("Inspect motor and power supply.");
  });

  it("leaves the failure type empty below the alert threshold", () => {
    expect(toRemote(unit("GT-03", 0.2, 0), 0.61).mode).toBeNull();
  });

  it("drives every unit while fresh and falls back to the tree when the service goes quiet", () => {
    const h = new PlantHost();
    h.scored([toRemote(unit("GT-03", 0.93, 1), 0.61), toRemote(unit("GT-05", 0.01, 0), 0.61)], 1000);
    h.tick(2000);
    expect(h.plant.predictions.find((p) => p.turbineId === "GT-03")).toMatchObject({ by: "Random Forest", mode: "PWF" });
    expect(h.plant.predictions.find((p) => p.turbineId === "GT-05")!.by).toBe("Random Forest");
    expect(h.plant.turbines[2].status).toBe("watch");
    h.tick(20000);
    expect(h.plant.predictions.find((p) => p.turbineId === "GT-05")!.by).toBe("Decision tree");
  });

  it("lets the ML laptop's own post win for its unit", () => {
    const h = new PlantHost();
    h.scored([toRemote(unit("GT-08", 0.01, 0), 0.61)], 1000);
    h.predict({ unit: "GT-08", probability: 0.7, model: "Team ML" }, 1000);
    h.tick(2000);
    expect(h.plant.predictions.find((p) => p.turbineId === "GT-08")!.by).toBe("Team ML");
  });
});

describe("diagnosis of a trip", () => {
  it("keeps the model's verdict on the trip reading until the unit runs again", () => {
    const h = new PlantHost();
    h.tick(1000);
    h.apply({ type: "trip", unit: "GT-02" });
    h.tick(2000);
    const flagged = {
      unit: "GT-02", failure_risk: 0.95, failure_class: 1 as const,
      failure_types: [{ code: "HDF" as const, name: "Heat dissipation failure", probability: 0.9 }],
      top_features: null, alert_level: "Critical" as const, suggested_action: "Inspect cooling.",
    };
    const atTrip = h.plant.turbines[1].features;
    expect(h.plant.turbines[1].tripReading).toEqual(atTrip);
    h.scored([toRemote({ ...flagged, unit: "GT-03" }, 0.61), toRemote(flagged, 0.61, true)], 2100);
    h.tick(3000);
    expect(h.plant.turbines[1].diagnosis?.action).toBe("Inspect cooling.");
    expect(h.plant.turbines[2].diagnosis ?? null).toBeNull();
    expect(h.plant.events.some((e) => e.text === "GT-02 model diagnosis: heat dissipation failure (95% risk)")).toBe(true);
    h.tick(30000);
    expect(h.plant.turbines[1].diagnosis?.action).toBe("Inspect cooling.");
    h.apply({ type: "reset", unit: "GT-02" });
    h.tick(31000);
    expect(h.plant.turbines[1].diagnosis).toBeNull();
    expect(h.plant.turbines[1].tripReading).toBeNull();
  });

  it("diagnoses the reading the unit tripped on, not a later one", async () => {
    const h = new PlantHost();
    h.ingest({ device: "b", seq: 1, uptime_ms: 1, readings: { type: "M", air_temp_k: 300.8, process_temp_k: 309.4, rpm: 1342, torque_nm: 62.4, tool_wear_min: 113 } }, 1000);
    h.tick(1000);
    h.apply({ type: "trip", unit: "GT-08" });
    h.tick(2000);
    h.ingest({ device: "b", seq: 2, uptime_ms: 2, readings: { type: "M", air_temp_k: 299, process_temp_k: 310, rpm: 1500, torque_nm: 40, tool_wear_min: 115 } }, 2500);
    h.tick(3000);
    let sent: { units: { unit: string; features: { rpm: number } }[] } | undefined;
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: { body: string }) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ threshold: 0.61, units: [] })); }) as typeof fetch;
    try {
      new MlScorer("http://x", () => {}).score(h.plant);
      await new Promise((r) => setTimeout(r, 10));
    } finally { globalThis.fetch = real; }
    expect(h.plant.turbines[7].features.rpm).toBe(1500);
    expect(sent!.units.find((u) => u.unit === "GT-08")!.features.rpm).toBe(1342);
  });
});
