import { describe, expect, it } from "vitest";
import { createPlant, derateFactor, predictOverheat, step, WATCH_TEMP_C } from "./engine";
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

  it("trips GT-01 when the live light sensor goes dark", () => {
    const s = step(createPlant(), {
      sensor: { device: "d", seq: 1, uptime_ms: 1, readings: { light_raw: 50 } },
      sensorAtMs: 1000,
      nowMs: 1500,
    });
    expect(s.ambient.source).toBe("live");
    expect(s.turbines[0].status).toBe("tripped");
  });

  it("ignores a dark light sensor when the reading is stale", () => {
    const s = step(createPlant(), {
      sensor: { device: "d", seq: 1, uptime_ms: 1, readings: { light_raw: 50 } },
      sensorAtMs: 1000,
      nowMs: 20000,
    });
    expect(s.ambient.source).toBe("sim");
    expect(s.turbines[0].status).not.toBe("tripped");
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

  it("prediction has no estimate for a flat trend", () => {
    expect(predictOverheat("GT-01", Array(60).fill(590)).minutesToLimit).toBeNull();
  });
});
