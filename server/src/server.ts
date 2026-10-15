import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { PlantHost } from "./plant.ts";
import type { z } from "zod";
import { ClientMessage, RemotePrediction, SensorReading, dropBadReadings } from "./protocol.ts";
import { CopilotLimiter, CopilotRequest, askGemini } from "./copilot.ts";
import { MlScorer } from "./ml.ts";
import { LoginLimiter, SESSION_COOKIE, allowed, clearedCookie, cookie, newSession, passwordOk, sessionCookie, sessionOk, type Role } from "./auth.ts";

const PORT = Number(process.env.PORT ?? 8787);
const DEVICE_TOKEN = process.env.DEVICE_TOKEN ?? "";
const MODEL_TOKEN = process.env.MODEL_TOKEN ?? "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const COPILOT_MAX_BODY = 12 * 1024;
const copilotLimit = new CopilotLimiter();
// Admin sign-in. The hash comes from `npm run hash-password`; the secret signs session cookies.
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ?? "";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "";
// The engineer phone proves itself with this in its hello. Without it a phone can only watch.
const PHONE_TOKEN = process.env.PHONE_TOKEN ?? "";
// OPEN_CONTROL=1 is for a laptop demo on a private network: every screen may run the plant, as before sign-in existed.
const OPEN_CONTROL = process.env.OPEN_CONTROL === "1";
const loginLimit = new LoginLimiter();

// Browsers may connect only from the team's own pages: local dev, the LAN at the venue, and the Vercel deployments.
// ALLOWED_ORIGINS (comma-separated, exact) replaces that list in production.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
const DEV_ORIGINS = [
  /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/,
  /^https:\/\/power-guard-360(-[a-z0-9]+-powerguard360)?\.vercel\.app$/,
];
function originOk(origin: string | undefined): origin is string {
  if (!origin) return false;
  return ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.includes(origin) : DEV_ORIGINS.some((r) => r.test(origin));
}
function allowOrigin(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (!originOk(origin)) return false;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("vary", "origin");
  return true;
}

// Behind Caddy every request arrives from loopback. Caddy replaces X-Forwarded-For with the address it saw,
// so a client can't pick its own rate-limit bucket.
function clientIp(req: IncomingMessage) {
  const remote = req.socket.remoteAddress ?? "";
  const xff = req.headers["x-forwarded-for"];
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  return loopback && typeof xff === "string" && xff ? xff.split(",")[0].trim() : remote;
}

function isAdmin(req: IncomingMessage) {
  return OPEN_CONTROL || sessionOk(SESSION_SECRET, cookie(req.headers.cookie, SESSION_COOKIE));
}

function login(req: IncomingMessage, res: ServerResponse) {
  if (!allowOrigin(req, res)) return send(res, 403, { error: "origin not allowed" });
  if (!ADMIN_PASSWORD_HASH || !SESSION_SECRET) return send(res, 503, { error: "Admin sign-in isn't configured on this server." });
  const ip = clientIp(req);
  if (loginLimit.blocked(ip)) return send(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
  readJson(req, res, (json) => {
    const password = (json as { password?: unknown } | null)?.password;
    if (typeof password !== "string" || password.length > 200 || !passwordOk(password, ADMIN_PASSWORD_HASH)) {
      loginLimit.failed(ip);
      console.warn(`[auth] failed admin sign-in from ${ip}`);
      return send(res, 401, { error: "Wrong password." });
    }
    loginLimit.succeeded(ip);
    console.log(`[auth] admin signed in from ${ip}`);
    res.setHeader("set-cookie", sessionCookie(newSession(SESSION_SECRET)));
    send(res, 200, { admin: true });
  });
}

function copilot(req: IncomingMessage, res: ServerResponse) {
  if (!allowOrigin(req, res)) return send(res, 403, { error: "origin not allowed" });
  if (!GEMINI_API_KEY) return send(res, 503, { error: "The copilot isn't configured on this server." });
  readJson(req, res, async (json) => {
    const parsed = CopilotRequest.safeParse(json);
    if (!parsed.success) return send(res, 400, { error: "Ask a question of up to 500 characters." });
    const ip = clientIp(req);
    const gate = copilotLimit.take(ip);
    if (gate !== "ok") {
      console.warn(`[copilot] ${ip} hit the ${gate} limit`);
      return send(res, 429, { error: gate === "minute" ? "Too many questions in a minute. Wait a moment and ask again." : "The copilot has reached today's question limit." });
    }
    try {
      send(res, 200, await askGemini(GEMINI_API_KEY, host.plant, parsed.data));
    } catch (e) {
      console.warn(`[copilot] ${(e as Error).message}`);
      send(res, 502, { error: "The copilot couldn't answer just now. Try again in a few seconds." });
    }
  }, COPILOT_MAX_BODY);
}
const MAX_BODY = 4 * 1024;
const ACTIONS_PER_SECOND = 20;

const host = new PlantHost();
// machine_learning/api.py. Set ML_SERVICE_URL=off to run on the decision tree alone.
const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8790";
const ml = ML_SERVICE_URL === "off" ? null : new MlScorer(ML_SERVICE_URL.replace(/\/$/, ""), (preds) => host.scored(preds));

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  // An explicit length lets small HTTP clients like the sensor board read one reply and reuse the connection.
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

// Each sender has its own token, so a leaked one can be rotated without touching the other device.
function tokenOk(req: IncomingMessage, token: string) {
  if (!token) return false;
  const got = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

function readJson(req: IncomingMessage, res: ServerResponse, done: (json: unknown) => void, limit = MAX_BODY) {
  let size = 0;
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > limit) { send(res, 413, { error: "too large" }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    let json: unknown;
    try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 400, { error: "invalid JSON" }); }
    done(json);
  });
}

// One line per 10 s at most, so a sensor stuck out of range doesn't flood the terminal.
let lastDropWarn = 0;
function warnDropped(from: string | undefined, dropped: string[]) {
  if (Date.now() - lastDropWarn < 10000) return;
  lastDropWarn = Date.now();
  console.warn(`[ingest] ignored out-of-range readings from ${from}: ${dropped.join(", ")} (the rest of the post was used)`);
}

// LOG_INGEST=1 prints every reading as received, for wiring up a new board.
const LOG_INGEST = process.env.LOG_INGEST === "1";

function post<T>(req: IncomingMessage, res: ServerResponse, name: string, token: string, schema: z.ZodType<T>, accept: (data: T) => void,
  clean?: (json: unknown) => { json: unknown; dropped: string[] }) {
  if (!tokenOk(req, token)) {
    console.warn(`[${name}] rejected request from ${req.socket.remoteAddress}: bad or missing token`);
    return send(res, 401, { error: "unauthorized" });
  }
  readJson(req, res, (raw) => {
    const cleaned = clean ? clean(raw) : { json: raw, dropped: [] };
    const json = cleaned.json;
    if (cleaned.dropped.length) warnDropped(req.socket.remoteAddress, cleaned.dropped);
    const parsed = schema.safeParse(json);
    if (LOG_INGEST) console.log(`[${name}] ${req.socket.remoteAddress} ${JSON.stringify(json)}`);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 5);
      console.warn(`[${name}] rejected from ${req.socket.remoteAddress}: ${issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      return send(res, 400, { error: `invalid ${name}`, issues });
    }
    accept(parsed.data);
    send(res, 200, { ok: true });
  });
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, t: host.plant.t });
  if (req.method === "POST" && req.url === "/api/ingest") return post(req, res, "ingest", DEVICE_TOKEN, SensorReading, (r) => host.ingest(r), dropBadReadings);
  if (req.url === "/api/copilot" && req.method === "OPTIONS") {
    if (!allowOrigin(req, res)) return send(res, 403, { error: "origin not allowed" });
    res.writeHead(204, { "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600" });
    return res.end();
  }
  if (req.method === "POST" && req.url === "/api/copilot") return copilot(req, res);
  if ((req.url === "/api/login" || req.url === "/api/logout" || req.url === "/api/session") && req.method === "OPTIONS") {
    if (!allowOrigin(req, res)) return send(res, 403, { error: "origin not allowed" });
    res.writeHead(204, { "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600" });
    return res.end();
  }
  if (req.method === "POST" && req.url === "/api/login") return login(req, res);
  if (req.method === "POST" && req.url === "/api/logout") {
    if (!allowOrigin(req, res)) return send(res, 403, { error: "origin not allowed" });
    res.setHeader("set-cookie", clearedCookie);
    return send(res, 200, { admin: false });
  }
  if (req.method === "GET" && req.url === "/api/session") {
    if (!allowOrigin(req, res)) return send(res, 403, { error: "origin not allowed" });
    return send(res, 200, { admin: isAdmin(req), signIn: !OPEN_CONTROL && Boolean(ADMIN_PASSWORD_HASH && SESSION_SECRET) });
  }
  if (req.method === "POST" && req.url === "/api/prediction") return post(req, res, "prediction", MODEL_TOKEN, RemotePrediction, (p) => host.predict(p));
  send(res, 404, { error: "not found" });
});

// A page from another site is turned away before the upgrade, so it can't ride on an admin's cookie.
// Apps send no Origin header (the phone); they may connect and watch, and need PHONE_TOKEN to act.
const wss = new WebSocketServer({
  server, path: "/ws", maxPayload: 2048,
  verifyClient: ({ req }: { req: IncomingMessage }) => {
    const origin = req.headers.origin;
    if (origin === undefined || originOk(origin)) return true;
    console.warn(`[ws] refused origin ${origin} from ${clientIp(req)}`);
    return false;
  },
});
const roleOf = new WeakMap<WebSocket, Role>();
const budget = new WeakMap<WebSocket, { second: number; count: number }>();
const phoneOf = new Map<WebSocket, string>();
function refreshPhones() {
  host.phonesOnline = new Set(phoneOf.values());
}

function phoneTokenOk(token: string | undefined) {
  if (OPEN_CONTROL) return true;
  if (!PHONE_TOKEN || !token) return false;
  const got = Buffer.from(token);
  const want = Buffer.from(PHONE_TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
}

wss.on("connection", (ws, req) => {
  // The admin cookie counts only on a page from an allowed origin; verifyClient refused the others.
  const role: Role = OPEN_CONTROL || (req.headers.origin && isAdmin(req)) ? "admin" : "viewer";
  roleOf.set(ws, role);
  console.log(`[ws] ${role} connected from ${clientIp(req)}, ${wss.clients.size} online`);
  ws.send(JSON.stringify({ type: "role", role }));
  ws.send(JSON.stringify({ type: "state", plant: host.plant }));
  ws.on("message", (raw) => {
    const now = Math.floor(Date.now() / 1000);
    const b = budget.get(ws);
    if (!b || b.second !== now) budget.set(ws, { second: now, count: 1 });
    else if (++b.count > ACTIONS_PER_SECOND) return;
    let json: unknown;
    try { json = JSON.parse(raw.toString()); } catch { return; }
    const parsed = ClientMessage.safeParse(json);
    if (!parsed.success) return ws.send(JSON.stringify({ type: "error", message: "unknown action" }));
    if (parsed.data.type === "hello") {
      if (!phoneTokenOk(parsed.data.token)) {
        console.warn(`[ws] phone hello from ${clientIp(req)} without a valid PHONE_TOKEN, staying read-only`);
        return ws.send(JSON.stringify({ type: "error", message: "read-only: phone token missing or wrong" }));
      }
      if (roleOf.get(ws) !== "admin") roleOf.set(ws, "phone");
      ws.send(JSON.stringify({ type: "role", role: roleOf.get(ws) }));
      phoneOf.set(ws, parsed.data.engineerId);
      refreshPhones();
      console.log(`[ws] phone app online as ${parsed.data.engineerId}`);
      return;
    }
    if (!allowed(roleOf.get(ws) ?? "viewer", parsed.data.action, phoneOf.get(ws))) {
      return ws.send(JSON.stringify({ type: "error", message: "read-only: sign in as admin to control the plant" }));
    }
    host.apply(parsed.data.action);
  });
  ws.on("close", () => {
    phoneOf.delete(ws);
    refreshPhones();
    console.log(`[ws] client left, ${wss.clients.size} online`);
  });
});

// Dead connections (phone locked, Wi-Fi dropped) are cut so they stop receiving broadcasts.
const alive = new WeakSet<WebSocket>();
wss.on("connection", (ws) => { alive.add(ws); ws.on("pong", () => alive.add(ws)); });
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) { ws.terminate(); continue; }
    alive.delete(ws);
    ws.ping();
  }
}, 15000);

setInterval(() => {
  const plant = host.tick();
  ml?.score(plant);
  const msg = JSON.stringify({ type: "state", plant });
  for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(msg);
}, 1000);

// Lets the board send many posts over one connection; the UNO R4 takes seconds to open a new one.
server.keepAliveTimeout = 60000;
server.headersTimeout = 65000;

server.listen(PORT, () => {
  console.log(`Power Guard 360 plant server on :${PORT}`);
  if (!DEVICE_TOKEN) console.warn("DEVICE_TOKEN is not set, so /api/ingest rejects every reading. Set it to accept the sensor board.");
  if (OPEN_CONTROL) console.warn("OPEN_CONTROL=1: every screen can run the plant. Use it only on a private network.");
  else if (!ADMIN_PASSWORD_HASH || !SESSION_SECRET) console.warn("ADMIN_PASSWORD_HASH or SESSION_SECRET is not set, so nobody can sign in and every browser is read-only.");
  if (!OPEN_CONTROL && !PHONE_TOKEN) console.warn("PHONE_TOKEN is not set, so the engineer phone can only watch.");
  if (ALLOWED_ORIGINS.length) console.log(`Browser origins allowed: ${ALLOWED_ORIGINS.join(", ")}`);
  if (!MODEL_TOKEN) console.warn("MODEL_TOKEN is not set, so /api/prediction rejects every forecast. Set it to accept the ML laptop.");
});
