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

  it("gives the model precomputed checks against each failure limit", () => {
    let p = createPlant();
    for (let i = 0; i < 5; i++) p = step(p);
    const ctx = plantContext(p, "GT-03");
    expect(ctx.focus).toBe("GT-03");
    expect(ctx.turbines).toHaveLength(8);
    expect(ctx.turbines[0].checks.overstrain).toMatch(/% of the 1[123]000 limit/);
  });
});
