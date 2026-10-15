import { describe, expect, it } from "vitest";
import { LoginLimiter, allowed, cookie, hashPassword, newSession, passwordOk, sessionOk } from "./auth.ts";

describe("roles", () => {
  it("lets a viewer do nothing", () => {
    expect(allowed("viewer", { type: "trip", unit: "GT-01" })).toBe(false);
    expect(allowed("viewer", { type: "review", recommendationId: "REC-1", decision: "request", note: "" })).toBe(false);
  });
  it("lets the admin do everything", () => {
    expect(allowed("admin", { type: "dispatch", requestId: "REQ-1", engineerId: "ENG-1" })).toBe(true);
  });
  it("lets the phone do only its own engineer's job", () => {
    expect(allowed("phone", { type: "accept", requestId: "REQ-1", engineerId: "ENG-4" }, "ENG-4")).toBe(true);
    expect(allowed("phone", { type: "accept", requestId: "REQ-1", engineerId: "ENG-1" }, "ENG-4")).toBe(false);
    expect(allowed("phone", { type: "trip", unit: "GT-02" }, "ENG-4")).toBe(true);
    expect(allowed("phone", { type: "dispatch", requestId: "REQ-1", engineerId: "ENG-4" }, "ENG-4")).toBe(false);
  });
});

describe("sign-in", () => {
  it("checks the password against its hash", () => {
    const h = hashPassword("correct horse battery");
    expect(passwordOk("correct horse battery", h)).toBe(true);
    expect(passwordOk("wrong", h)).toBe(false);
    expect(passwordOk("", h)).toBe(false);
  });
  it("accepts only unexpired sessions signed with the same secret", () => {
    const t = newSession("s1", 1000);
    expect(sessionOk("s1", t, 2000)).toBe(true);
    expect(sessionOk("s2", t, 2000)).toBe(false);
    expect(sessionOk("s1", t, 1000 + 9 * 3600_000)).toBe(false);
    expect(sessionOk("s1", t.replace(/^\d+/, "99999999999999"), 2000)).toBe(false);
    expect(sessionOk("", t, 2000)).toBe(false);
  });
  it("reads one cookie out of the header", () => {
    expect(cookie("a=1; pg_admin=x.y.z; b=2", "pg_admin")).toBe("x.y.z");
    expect(cookie(undefined, "pg_admin")).toBeUndefined();
  });
  it("blocks an address after 5 wrong passwords", () => {
    const l = new LoginLimiter();
    for (let i = 0; i < 5; i++) l.failed("1.2.3.4", 0);
    expect(l.blocked("1.2.3.4", 1)).toBe(true);
    expect(l.blocked("5.6.7.8", 1)).toBe(false);
    expect(l.blocked("1.2.3.4", 16 * 60_000)).toBe(false);
  });
});
