import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { PlantHost } from "./plant.ts";
import { ClientMessage, SensorReading } from "./protocol.ts";

const PORT = Number(process.env.PORT ?? 8787);
const DEVICE_TOKEN = process.env.DEVICE_TOKEN ?? "";
const MAX_BODY = 4 * 1024;
const ACTIONS_PER_SECOND = 20;

const host = new PlantHost();

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function tokenOk(req: IncomingMessage) {
  if (!DEVICE_TOKEN) return false;
  const got = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  const want = Buffer.from(DEVICE_TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true, t: host.plant.t });
  if (req.method === "POST" && req.url === "/api/ingest") {
    if (!tokenOk(req)) {
      console.warn(`[ingest] rejected request from ${req.socket.remoteAddress}: bad or missing token`);
      return send(res, 401, { error: "unauthorized" });
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { send(res, 413, { error: "too large" }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      let json: unknown;
      try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 400, { error: "invalid JSON" }); }
      const parsed = SensorReading.safeParse(json);
      if (!parsed.success) return send(res, 400, { error: "invalid reading", issues: parsed.error.issues.slice(0, 5) });
      host.ingest(parsed.data);
      send(res, 200, { ok: true });
    });
    return;
  }
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

server.listen(PORT, () => {
  console.log(`Power Guard 360 plant server on :${PORT}`);
  if (!DEVICE_TOKEN) console.warn("DEVICE_TOKEN is not set, so /api/ingest rejects every reading. Set it to accept the sensor board.");
});
