import { describe, expect, it } from "vitest";
import { createPlant, derateFactor, predictOverheat, splitRoute, step, WATCH_TEMP_C } from "./engine";
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

describe("shipments", () => {
  it("phone GPS takes over a trailer and moves it along its route", () => {
    const s0 = createPlant();
    const before = s0.shipments[0].remainingKm;
    const s1 = step(s0, { gpsKm: [{ shipmentId: "TRL-204", km: 5 }] });
    expect(s1.shipments[0].source).toBe("live");
    expect(before - s1.shipments[0].remainingKm).toBeCloseTo(5, 1);
    const s2 = step(s1);
    expect(s2.shipments[0].remainingKm).toBeCloseTo(s1.shipments[0].remainingKm, 5);
    const s3 = step(s2, { gpsRelease: ["TRL-204"] });
    expect(s3.shipments[0].source).toBe("sim");
  });

  it("splits a route at the current position", () => {
    const sh = createPlant().shipments[0];
    const [driven, rest] = splitRoute(sh.route, 0.5);
    expect(driven[driven.length - 1]).toEqual(rest[0]);
    expect(rest[rest.length - 1]).toEqual(sh.route[sh.route.length - 1]);
  });
});

describe("deliveries", () => {
  it("a crew unloads an arrived truck and carries the parts to the asset", () => {
    let s = createPlant();
    s = step(s, { gpsKm: [{ shipmentId: "TRL-204", km: 1000 }] });
    expect(s.shipments[0].arrived).toBe(true);
    let d = s.deliveries.find((x) => x.shipmentId === "TRL-204")!;
    expect(d.status).toBe("unloading");
    expect(d.toAsset).toBe("GT-03");
    const firstEta = d.etaMin;
    for (let i = 0; i < 25; i++) s = step(s);
    d = s.deliveries.find((x) => x.shipmentId === "TRL-204")!;
    expect(d.status).toBe("carrying");
    expect(d.etaMin).toBeLessThan(firstEta);
    for (let i = 0; i < 400 && d.status !== "delivered"; i++) { s = step(s); d = s.deliveries.find((x) => x.shipmentId === "TRL-204")!; }
    expect(d.status).toBe("delivered");
    expect(d.pos).toEqual(d.path[d.path.length - 1]);
    expect(s.events.some((e) => e.text.includes("delivered combustion liner set"))).toBe(true);
  });

  it("each arrived shipment gets its own crew", () => {
    let s = createPlant();
    for (const id of ["TRL-204", "TNK-118", "TRL-311"]) s = step(s, { gpsKm: [{ shipmentId: id, km: 1000 }] });
    expect(new Set(s.deliveries.map((d) => d.crew)).size).toBe(3);
  });
});
