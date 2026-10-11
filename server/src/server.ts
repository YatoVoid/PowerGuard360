import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { PlantHost } from "./plant.ts";
import type { z } from "zod";
import { ClientMessage, RemotePrediction, SensorReading, dropBadReadings } from "./protocol.ts";
import { CopilotLimiter, CopilotRequest, askGemini } from "./copilot.ts";

const PORT = Number(process.env.PORT ?? 8787);
const DEVICE_TOKEN = process.env.DEVICE_TOKEN ?? "";
const MODEL_TOKEN = process.env.MODEL_TOKEN ?? "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const COPILOT_MAX_BODY = 12 * 1024;
const copilotLimit = new CopilotLimiter();

// Browsers may call the copilot only from the team's own pages: local dev, the LAN at the venue, and the Vercel deployments.
const ORIGIN_OK = [
  /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/,
  /^https:\/\/power-guard-360(-[a-z0-9]+-powerguard360)?\.vercel\.app$/,
];
function allowOrigin(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (!origin || !ORIGIN_OK.some((r) => r.test(origin))) return false;
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "origin");
  return true;
}

// Behind the Cloudflare tunnel every request arrives from loopback, so use the address Cloudflare saw.
function clientIp(req: IncomingMessage) {
  const remote = req.socket.remoteAddress ?? "";
  const cf = req.headers["cf-connecting-ip"];
  return (remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1") && typeof cf === "string" ? cf : remote;
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

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
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
  if (req.method === "POST" && req.url === "/api/prediction") return post(req, res, "prediction", MODEL_TOKEN, RemotePrediction, (p) => host.predict(p));
  send(res, 404, { error: "not found" });
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 2048 });
const budget = new WeakMap<WebSocket, { second: number; count: number }>();
const phoneOf = new Map<WebSocket, string>();
function refreshPhones() {
  host.phonesOnline = new Set(phoneOf.values());
}

wss.on("connection", (ws, req) => {
  console.log(`[ws] client connected from ${req.socket.remoteAddress}, ${wss.clients.size} online`);
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
      phoneOf.set(ws, parsed.data.engineerId);
      refreshPhones();
      console.log(`[ws] phone app online as ${parsed.data.engineerId}`);
      return;
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
  const msg = JSON.stringify({ type: "state", plant });
  for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(msg);
}, 1000);

// Lets the board send many posts over one connection; the UNO R4 takes seconds to open a new one.
server.keepAliveTimeout = 60000;
server.headersTimeout = 65000;

server.listen(PORT, () => {
  console.log(`Power Guard 360 plant server on :${PORT}`);
  if (!DEVICE_TOKEN) console.warn("DEVICE_TOKEN is not set, so /api/ingest rejects every reading. Set it to accept the sensor board.");
  if (!MODEL_TOKEN) console.warn("MODEL_TOKEN is not set, so /api/prediction rejects every forecast. Set it to accept the ML laptop.");
});
