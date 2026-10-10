import { describe, expect, it } from "vitest";
import { createPlant, derateFactor, PHONE_ENGINEER, predictOverheat, REPAIR_S, step, WATCH_TEMP_C } from "./engine";
import type { PlantState, StepInputs } from "../types";

function run(state: PlantState, seconds: number, inputs: StepInputs = {}) {
  let s = state;
  for (let i = 0; i < seconds; i++) s = step(s, inputs);
  return s;
}

describe("plant engine", () => {
  it("is deterministic for the same seed", () => {
    expect(run(createPlant(3), 120).outputMw).toBe(run(createPlant(3), 120).outputMw);
  });

  it("battery covers the gap when a turbine trips", () => {
    const steady = run(createPlant(), 60);
    const tripped = step(steady, { tripRequests: ["GT-02"] });
    expect(tripped.turbines[1].status).toBe("tripped");
    expect(tripped.turbines[1].outputMw).toBe(0);
    expect(tripped.battery.powerMw).toBeGreaterThan(100);
    expect(tripped.events.some((e) => e.severity === "trip" && e.asset === "GT-02")).toBe(true);
  });

  it("trips GT-08 when its live flame sensor goes dark", () => {
    const s = step(createPlant(), {
      sensor: { device: "d", seq: 1, uptime_ms: 1, readings: { light_raw: 50 } },
      sensorAtMs: 1000,
      nowMs: 1500,
    });
    expect(s.ambient.source).toBe("live");
    expect(s.turbines[7].sensors.source).toBe("live");
    expect(s.turbines[7].status).toBe("tripped");
    expect(s.turbines[0].status).not.toBe("tripped");
  });

  it("ignores a dark light sensor when the reading is stale", () => {
    const s = step(createPlant(), {
      sensor: { device: "d", seq: 1, uptime_ms: 1, readings: { light_raw: 50 } },
      sensorAtMs: 1000,
      nowMs: 20000,
    });
    expect(s.ambient.source).toBe("sim");
    expect(s.turbines[7].sensors.source).toBe("sim");
    expect(s.turbines[7].status).not.toBe("tripped");
  });

  it("GT-03 drifts into watch and is flagged before it trips", () => {
    let s = createPlant();
    let flaggedEarly = false;
    for (let i = 0; i < 900 && s.turbines[2].status === "running"; i++) {
      s = step(s);
      const p = s.predictions.find((x) => x.turbineId === "GT-03");
      if (p && p.minutesToLimit !== null && s.turbines[2].exhaustTempC < WATCH_TEMP_C) flaggedEarly = true;
    }
    expect(s.turbines[2].status).toBe("watch");
    expect(flaggedEarly).toBe(true);
  });

  it("lower pressure derates capacity", () => {
    expect(derateFactor(980, 31)).toBeLessThan(derateFactor(1013, 31));
  });

  it("healthy turbines are not flagged once start-up settles", () => {
    const s = run(createPlant(), 120);
    const healthy = s.predictions.filter((p) => p.turbineId !== "GT-03" && p.minutesToLimit !== null);
    expect(healthy).toEqual([]);
  });

  it("never flags a healthy turbine across ten minutes of load bursts", () => {
    let s = createPlant();
    for (let i = 0; i < 600; i++) {
      s = step(s);
      const falseAlarm = s.predictions.find((p) => p.turbineId !== "GT-03" && p.minutesToLimit !== null);
      expect(falseAlarm).toBeUndefined();
    }
  });

  it("does not forecast during the start-up settle", () => {
    expect(predictOverheat("GT-01", [600], Array.from({ length: 40 }, (_, i) => i * 0.5)).minutesToLimit).toBeNull();
  });

    it("prediction has no estimate for a flat trend", () => {
    expect(predictOverheat("GT-01", Array(120).fill(590), Array(120).fill(0.4)).minutesToLimit).toBeNull();
  });
});

describe("maintenance", () => {
  it("a trip raises a P1 request and dispatches the phone engineer first", () => {
    let s = run(createPlant(), 30);
    s = step(s, { tripRequests: ["GT-05"] });
    s = step(s);
    const r = s.requests.find((x) => x.asset === "GT-05")!;
    expect(r.priority).toBe("P1");
    expect(r.origin).toBe("auto");
    expect(r.status).toBe("dispatched");
    expect(r.engineerId).toBe(PHONE_ENGINEER);
  });

  it("the phone engineer walks only when GPS steps arrive, then repairs and clears the trip", () => {
    let s = run(createPlant(), 30);
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
    expect(s.requests.find((x) => x.id === id)!.status).toBe("on-site");
    s = step(s, { startRepair: [id] });
    for (let i = 0; i < REPAIR_S; i++) s = step(s);
    expect(s.requests.find((x) => x.id === id)!.status).toBe("resolved");
    expect(s.turbines[4].status).toBe("running");
    expect(s.engineers.find((e) => e.id === PHONE_ENGINEER)!.status).toBe("available");
  });

  it("a manual request goes to a free engineer, and simulated crew finish it on their own", () => {
    let s = createPlant();
    s = step(s, { tripRequests: ["GT-02"] });
    s = step(s);
    s = step(s, { newRequests: [{ asset: "switchyard", reason: "Breaker 4 alarm" }] });
    const r = s.requests.find((x) => x.asset === "switchyard")!;
    expect(r.origin).toBe("manual");
    expect(r.engineerId).not.toBe(PHONE_ENGINEER);
    for (let i = 0; i < 300 && s.requests.find((x) => x.id === r.id)!.status !== "resolved"; i++) s = step(s);
    expect(s.requests.find((x) => x.id === r.id)!.status).toBe("resolved");
  });

  it("GT-03's forecast raises a request before it reaches watch, and the fix stops the drift", () => {
    let s = createPlant();
    let raisedEarly = false;
    for (let i = 0; i < 600; i++) {
      s = step(s, { autoWalk: [{ engineerId: PHONE_ENGINEER, on: true }] });
      const r = s.requests.find((x) => x.asset === "GT-03");
      if (r && r.status === "dispatched") s = step(s, { accept: [{ requestId: r.id, engineerId: PHONE_ENGINEER }] });
      if (r && r.status === "on-site") s = step(s, { startRepair: [r.id] });
      if (r && s.turbines[2].exhaustTempC < WATCH_TEMP_C && r.priority === "P3") raisedEarly = true;
    }
    expect(raisedEarly).toBe(true);
    expect(s.requests.some((x) => x.asset === "GT-03" && x.status === "resolved")).toBe(true);
    expect(s.turbines[2].status).not.toBe("tripped");
  });

  it("does not open a second request for an asset that already has one", () => {
    let s = createPlant();
    s = step(s, { newRequests: [{ asset: "GT-01", reason: "a" }] });
    s = step(s, { newRequests: [{ asset: "GT-01", reason: "b" }] });
    expect(s.requests.filter((x) => x.asset === "GT-01").length).toBe(1);
  });
});
