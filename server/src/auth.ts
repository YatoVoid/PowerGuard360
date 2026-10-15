import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Action } from "./protocol.ts";

// Who is on the other end of a socket. Viewers watch; the phone does an engineer's job; only an admin runs the plant.
export type Role = "viewer" | "phone" | "admin";

// What the engineer phone may do: its own job, its own walking, and the trip/reset buttons a field engineer has.
const PHONE_ACTIONS = new Set<Action["type"]>(["accept", "walk", "autoWalk", "startRepair", "trip", "reset"]);

export function allowed(role: Role, action: Action, phoneEngineer?: string) {
  if (role === "admin") return true;
  if (role !== "phone" || !PHONE_ACTIONS.has(action.type)) return false;
  // A phone acts only as the engineer it said hello as.
  return !("engineerId" in action) || action.engineerId === phoneEngineer;
}

export const SESSION_COOKIE = "pg_admin";
export const SESSION_HOURS = 8;

// ADMIN_PASSWORD_HASH is "scrypt:<salt>:<hash>" from `npm run hash-password`, so the password itself is never stored.
export function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("base64")}:${scryptSync(password, salt, 32).toString("base64")}`;
}

export function passwordOk(password: string, stored: string) {
  const [kind, salt, hash] = stored.split(":");
  if (kind !== "scrypt" || !salt || !hash || !password) return false;
  const want = Buffer.from(hash, "base64");
  const got = scryptSync(password, Buffer.from(salt, "base64"), want.length);
  return timingSafeEqual(got, want);
}

// A session is "<expiry ms>.<nonce>.<hmac>", signed with SESSION_SECRET. Changing the secret signs everyone out.
function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function newSession(secret: string, now = Date.now()) {
  const body = `${now + SESSION_HOURS * 3600_000}.${randomBytes(12).toString("base64url")}`;
  return `${body}.${sign(secret, body)}`;
}

export function sessionOk(secret: string, token: string | undefined, now = Date.now()) {
  if (!secret || !token) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const body = token.slice(0, i);
  const got = Buffer.from(token.slice(i + 1));
  const want = Buffer.from(sign(secret, body));
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  return Number(body.split(".")[0]) > now;
}

export function cookie(header: string | undefined, name: string) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

// HttpOnly keeps the session out of page scripts; SameSite=Strict keeps other sites from riding on it.
// No Domain attribute, so only the API host ever receives it.
export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}
export const clearedCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

// Slows down password guessing: 5 failed tries per address per 15 minutes.
export class LoginLimiter {
  private fails = new Map<string, { since: number; count: number }>();
  constructor(private max = 5, private windowMs = 15 * 60_000) {}
  blocked(ip: string, now = Date.now()) {
    const f = this.fails.get(ip);
    if (f && now - f.since > this.windowMs) this.fails.delete(ip);
    return (this.fails.get(ip)?.count ?? 0) >= this.max;
  }
  failed(ip: string, now = Date.now()) {
    const f = this.fails.get(ip);
    if (!f || now - f.since > this.windowMs) this.fails.set(ip, { since: now, count: 1 });
    else f.count++;
    if (this.fails.size > 10_000) this.fails.clear();
  }
  succeeded(ip: string) {
    this.fails.delete(ip);
  }
}
