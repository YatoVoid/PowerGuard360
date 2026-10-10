import { expect, it } from "vitest";
import { createPlant, step } from "./engine";
it.each([1, 3, 7, 42, 99, 2026])("seed %i: no healthy false alarms, GT-03 flagged before watch", (seed) => {
  let s = createPlant(seed);
  let flagged = false;
  for (let i = 0; i < 600; i++) {
    s = step(s);
    expect(s.predictions.find((p) => p.turbineId !== "GT-03" && p.minutesToLimit !== null)).toBeUndefined();
    if (s.turbines[2].status === "running" && s.predictions.find((p) => p.turbineId === "GT-03")?.minutesToLimit) flagged = true;
  }
  expect(flagged).toBe(true);
});
