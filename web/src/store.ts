import { create } from "zustand";
import { createPlant, step } from "./sim/engine";
import type { PlantState, StepInputs } from "./types";

export type View = "twin" | "dashboard" | "maintenance";
export type CameraPreset = "overview" | "top" | "turbines" | "control";

// Same action shapes the plant server accepts (server/src/protocol.ts).
export type Action =
  | { type: "trip"; unit: string }
  | { type: "reset"; unit: string }
  | { type: "request"; asset: string; reason: string }
  | { type: "cancel"; requestId: string }
  | { type: "dispatch"; requestId: string; engineerId: string }
  | { type: "review"; recommendationId: string; decision: "request" | "decline"; note: string };

// "live" = following the shared plant server; "local" = running our own copy because no server is reachable.
export type Link = "connecting" | "live" | "local";
// What the plant server lets this page do. Visitors watch; a signed-in admin runs the plant.
export type Role = "viewer" | "admin";

interface Store {
  plant: PlantState;
  link: Link;
  role: Role;
  view: View;
  selected: string | null;
  showLabels: boolean;
  cameraPreset: { name: CameraPreset; n: number } | null;
  setShowLabels: (v: boolean) => void;
  goTo: (name: CameraPreset) => void;
  setView: (v: View) => void;
  select: (id: string | null) => void;
  act: (a: Action) => void;
  trip: (id: string) => void;
  reset: (id: string) => void;
}

type LocalQueue = Required<Pick<StepInputs, "tripRequests" | "resetRequests" | "newRequests" | "cancel" | "dispatch" | "review" | "accept" | "autoWalk">>;
const emptyQueue = (): LocalQueue => ({ tripRequests: [], resetRequests: [], newRequests: [], cancel: [], dispatch: [], review: [], accept: [], autoWalk: [] });
let queue = emptyQueue();
let socket: WebSocket | null = null;

// ?ff=360 starts the plant six minutes in, for rehearsing the later parts of the demo.
function initialPlant() {
  let plant = createPlant();
  const ff = Math.min(1800, Math.max(0, Number(new URLSearchParams(location.search).get("ff")) || 0));
  for (let i = 0; i < ff; i++) plant = step(plant);
  return plant;
}

function viewFromHash(): View {
  const h = location.hash.replace("#", "");
  return h === "dashboard" || h === "maintenance" ? h : "twin";
}

export const useStore = create<Store>((set, get) => ({
  plant: initialPlant(),
  link: "connecting",
  role: "viewer",
  view: viewFromHash(),
  selected: null,
  showLabels: true,
  cameraPreset: null,
  setShowLabels: (showLabels) => set({ showLabels }),
  goTo: (name) => set((s) => ({ cameraPreset: { name, n: (s.cameraPreset?.n ?? 0) + 1 } })),
  setView: (view) => {
    history.replaceState(null, "", `${location.search}#${view}`);
    set({ view });
  },
  select: (selected) => set({ selected }),
  act: (a) => {
    if (get().link === "live" && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "action", action: a }));
      return;
    }
    if (a.type === "trip") queue.tripRequests.push(a.unit);
    if (a.type === "reset") queue.resetRequests.push(a.unit);
    if (a.type === "request") queue.newRequests.push({ asset: a.asset, reason: a.reason });
    if (a.type === "cancel") queue.cancel.push(a.requestId);
    if (a.type === "dispatch") queue.dispatch.push({ requestId: a.requestId, engineerId: a.engineerId });
    if (a.type === "review") queue.review.push({ recommendationId: a.recommendationId, decision: a.decision, note: a.note });
  },
  trip: (unit) => get().act({ type: "trip", unit }),
  reset: (unit) => get().act({ type: "reset", unit }),
}));

// On the shared plant only an admin may act; a page running its own copy controls it freely.
export const useCanControl = () => useStore((s) => s.link !== "live" || s.role === "admin");

function localTick() {
  const s = useStore.getState();
  if (s.link === "live") return;
  // Without a phone connected, the phone engineer walks on their own so a local demo still completes.
  const phone = s.plant.engineers.find((e) => e.kind === "phone");
  const pending = s.plant.requests.find((r) => r.engineerId === phone?.id && r.status === "dispatched");
  if (phone && !phone.autoWalk) queue.autoWalk.push({ engineerId: phone.id, on: true });
  if (phone && pending) queue.accept.push({ requestId: pending.id, engineerId: phone.id });
  const plant = step(s.plant, { ...queue, nowMs: Date.now() });
  queue = emptyQueue();
  useStore.setState({ plant });
}

// Local pages talk to the plant server on the same machine; a deployed page needs VITE_WS_URL pointing at a wss:// server.
export function serverUrl() {
  // ?ws=wss://host/ws points a deployed page at a tunnel without rebuilding it.
  const override = new URLSearchParams(location.search).get("ws");
  if (override && /^wss?:\/\/[^\s]+$/.test(override)) return override;
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  if (location.protocol === "https:") return null;
  return `ws://${location.hostname}:8787/ws`;
}

// After signing in or out the socket is reopened at once, so the server reads the new session cookie.
let reopenNow = false;
export function reconnect() {
  if (!socket) return;
  reopenNow = true;
  socket.close();
}

function connect() {
  const url = serverUrl();
  if (!url) { useStore.setState({ link: "local" }); return () => {}; }
  let stopped = false;
  let retry = 0;
  const open = () => {
    if (stopped) return;
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { useStore.setState({ link: "local" }); retry = window.setTimeout(open, 5000); return; }
    socket = ws;
    const giveUp = window.setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close(); }, 2500);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: string; plant?: PlantState; role?: string };
      if (msg.type === "state" && msg.plant) useStore.setState({ plant: msg.plant, link: "live" });
      if (msg.type === "role") useStore.setState({ role: msg.role === "admin" ? "admin" : "viewer" });
    };
    ws.onclose = () => {
      window.clearTimeout(giveUp);
      if (socket === ws) socket = null;
      useStore.setState({ link: reopenNow ? "connecting" : "local", role: "viewer" });
      if (!stopped) retry = window.setTimeout(open, reopenNow ? 0 : 5000);
      reopenNow = false;
    };
  };
  open();
  return () => { stopped = true; window.clearTimeout(retry); socket?.close(); };
}

export function startClock() {
  const stopLink = connect();
  const id = window.setInterval(localTick, 1000);
  return () => { window.clearInterval(id); stopLink(); };
}
