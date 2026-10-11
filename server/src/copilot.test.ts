import { describe, expect, it } from "vitest";
import { createPlant, step } from "../../web/src/sim/engine.ts";
import { CopilotAnswer, CopilotLimiter, CopilotRequest, plantContext } from "./copilot.ts";

describe("copilot", () => {
  it("caps questions per address per minute and per day", () => {
    const l = new CopilotLimiter(2, 3);
    expect(l.take("a", 0)).toBe("ok");
    expect(l.take("a", 1)).toBe("ok");
    expect(l.take("a", 2)).toBe("minute");
    expect(l.take("a", 61000)).toBe("ok");
    expect(l.take("b", 61001)).toBe("day");
  });

  it("rejects oversized or empty questions", () => {
    expect(CopilotRequest.safeParse({ question: "  " }).success).toBe(false);
    expect(CopilotRequest.safeParse({ question: "x".repeat(501) }).success).toBe(false);
    expect(CopilotRequest.safeParse({ question: "Status?", focus: "GT-09" }).success).toBe(false);
  });

  it("drops a suggestion for an asset outside the plant", () => {
    const a = CopilotAnswer.parse({ answer: "ok", assets: ["GT-02"], suggestion: { asset: "admin", reason: "x" } });
    expect(a.suggestion).toBeNull();
  });

  it("gives reference margins against each failure rule", () => {
    let p = createPlant();
    for (let i = 0; i < 5; i++) p = step(p);
    const ctx = plantContext(p, "GT-03");
    expect(ctx.focus).toBe("GT-03");
    expect(ctx.turbines).toHaveLength(8);
    expect(ctx.turbines[0].reference_margins.overstrain).toMatch(/% of the 1[123]000 limit/);
  });

  const ml = (failureClass: 0 | 1) => ({
    failureClass, alertLevel: failureClass ? "Critical" as const : "Normal" as const, threshold: 0.61,
    types: failureClass ? [{ code: "OSF" as const, name: "Overstrain failure", probability: 0.95 }] : [],
    factors: null, action: failureClass ? "Reduce load and replace the tool." : "No action.",
  });
  const scored = (risk: number, cls: 0 | 1) => step(createPlant(), {
    remote: [{ unit: "GT-08", probability: risk, mode: cls ? "OSF" : null, model: "Random Forest", ml: ml(cls) }], remoteAtMs: 1000, nowMs: 2000,
  });

  it("calls a unit healthy when the model sees no failure, even close to a rule limit, and never gives a failure time", () => {
    const p = scored(0.02, 0);
    p.turbines[7].features = { ...p.turbines[7].features, type: "M", toolWearMin: 253, torqueNm: 46 };
    const gt08 = plantContext(p, "GT-08").turbines[7];
    expect(gt08.reference_margins.overstrain).toMatch(/9\d% of the 12000 limit/);
    expect(gt08.model_verdict).toMatchObject({ verdict: expect.stringMatching(/^healthy/), failure_risk: "2%", likely_failures: [], recommended_check: null });
    expect(JSON.stringify(plantContext(p, null))).not.toMatch(/minutes_to_failure|likely in/);
  });

  it("reports the model's flag, failure type and check when it does see one", () => {
    const gt08 = plantContext(scored(0.95, 1), "GT-08").turbines[7];
    expect(gt08.model_verdict).toMatchObject({
      verdict: expect.stringMatching(/^maintenance recommended/), alert_level: "Critical",
      likely_failures: ["Overstrain failure 95%"], recommended_check: "Reduce load and replace the tool.",
    });
  });
});
