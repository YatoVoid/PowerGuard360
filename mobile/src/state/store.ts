import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';
import { Platform, Vibration } from 'react-native';
import { create } from 'zustand';

import { PHONE_ENGINEER, createPlant, step } from '@engine/sim/engine';
import type { MaintenanceRequest, PlantState, StepInputs } from '@engine/types';

// Each shake is one stride on site. A few seconds of shaking crosses the plant, which suits a demo table.
export const SHAKE_STEP_M = 12;
// Acceleration beyond gravity, in g, that counts as a shake, and the shortest gap between two strides.
const SHAKE_G = 0.7;
const STRIDE_GAP_MS = 220;
export const ME = PHONE_ENGINEER;

// Over USB, `adb reverse tcp:8787 tcp:8787` makes the laptop's plant server reachable at 127.0.0.1.
const SERVER = process.env.EXPO_PUBLIC_WS_URL ?? 'ws://127.0.0.1:8787/ws';
// The server's PHONE_TOKEN. Without it the hosted server keeps this phone read-only; a laptop demo with OPEN_CONTROL doesn't need it.
const PHONE_TOKEN = process.env.EXPO_PUBLIC_PHONE_TOKEN;

export type Link = 'connecting' | 'live' | 'local';
export type Action =
  | { type: 'trip'; unit: string }
  | { type: 'reset'; unit: string }
  | { type: 'request'; asset: string; reason: string }
  | { type: 'cancel'; requestId: string }
  | { type: 'accept'; requestId: string; engineerId: string }
  | { type: 'walk'; engineerId: string; meters: number }
  | { type: 'autoWalk'; engineerId: string; on: boolean }
  | { type: 'startRepair'; requestId: string };

export interface Shake {
  status: 'listening' | 'unavailable';
  steps: number;
}

export interface Alert { requestId: string; title: string; body: string; priority: MaintenanceRequest['priority'] }

interface Store {
  plant: PlantState;
  link: Link;
  alert: Alert | null;
  dismissAlert: () => void;
  selected: string | null;
  shake: Shake | null;
  select: (id: string | null) => void;
  act: (a: Action) => void;
  trip: (id: string) => void;
  reset: (id: string) => void;
  startShake: () => Promise<void>;
  stopShake: () => void;
}

type Queue = Required<Pick<StepInputs, 'tripRequests' | 'resetRequests' | 'newRequests' | 'cancel' | 'accept' | 'walkM' | 'autoWalk' | 'startRepair'>>;
const emptyQueue = (): Queue => ({ tripRequests: [], resetRequests: [], newRequests: [], cancel: [], accept: [], walkM: [], autoWalk: [], startRepair: [] });
let queue = emptyQueue();
let socket: WebSocket | null = null;
let shakeSub: { remove: () => void } | null = null;

export const useStore = create<Store>((set, get) => ({
  plant: createPlant(),
  link: 'connecting',
  alert: null,
  dismissAlert: () => set({ alert: null }),
  selected: null,
  shake: null,
  select: (selected) => set({ selected }),
  act: (a) => {
    if (get().link === 'live' && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'action', action: a }));
      return;
    }
    switch (a.type) {
      case 'trip': queue.tripRequests.push(a.unit); break;
      case 'reset': queue.resetRequests.push(a.unit); break;
      case 'request': queue.newRequests.push({ asset: a.asset, reason: a.reason }); break;
      case 'cancel': queue.cancel.push(a.requestId); break;
      case 'accept': queue.accept.push({ requestId: a.requestId, engineerId: a.engineerId }); break;
      case 'walk': queue.walkM.push({ engineerId: a.engineerId, meters: a.meters }); break;
      case 'autoWalk': queue.autoWalk.push({ engineerId: a.engineerId, on: a.on }); break;
      case 'startRepair': queue.startRepair.push(a.requestId); break;
    }
  },
  trip: (unit) => get().act({ type: 'trip', unit }),
  reset: (unit) => get().act({ type: 'reset', unit }),
  startShake: async () => {
    get().stopShake();
    const ok = await Accelerometer.isAvailableAsync().catch(() => false);
    if (!ok) { set({ shake: { status: 'unavailable', steps: 0 } }); return; }
    set({ shake: { status: 'listening', steps: 0 } });
    Accelerometer.setUpdateInterval(40);
    let lastStride = 0;
    shakeSub = Accelerometer.addListener(({ x, y, z }) => {
      const now = Date.now();
      if (Math.abs(Math.hypot(x, y, z) - 1) < SHAKE_G || now - lastStride < STRIDE_GAP_MS) return;
      lastStride = now;
      const sh = get().shake;
      if (!sh) return;
      set({ shake: { ...sh, steps: sh.steps + 1 } });
      Haptics.selectionAsync().catch(() => {});
      get().act({ type: 'walk', engineerId: ME, meters: SHAKE_STEP_M });
    });
  },
  stopShake: () => {
    shakeSub?.remove();
    shakeSub = null;
    set({ shake: null });
  },
}));

// ---- notifications ----

// Expo Go on Android no longer ships expo-notifications (it throws on import), so system notifications
// are only used in a real build. Every build also gets the in-app alert banner and a vibration pattern.
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
type NotificationsModule = typeof import('expo-notifications');
let Notifications: NotificationsModule | null = null;
if (!inExpoGo) {
  try {
    Notifications = require('expo-notifications') as NotificationsModule;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
  } catch {
    Notifications = null;
  }
}

export async function prepareNotifications() {
  if (!Notifications) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('maintenance', {
      name: 'Maintenance requests',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 300, 150, 300],
    }).catch(() => {});
  }
  await Notifications.requestPermissionsAsync().catch(() => null);
}

const notified = new Set<string>();
function notifyAssignments(plant: PlantState) {
  const mine = plant.requests.filter((r) => r.engineerId === ME && r.status === 'dispatched');
  for (const r of mine) {
    if (notified.has(r.id)) continue;
    notified.add(r.id);
    const title = `${r.priority} ${r.id}: ${r.asset}`;
    const body = r.reason;
    useStore.setState({ alert: { requestId: r.id, title, body, priority: r.priority } });
    Vibration.vibrate(r.priority === 'P1' ? [0, 500, 200, 500, 200, 500] : [0, 400, 200, 400]);
    Haptics.notificationAsync(r.priority === 'P1' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Warning).catch(() => {});
    Notifications?.scheduleNotificationAsync({
      content: { title, body: `${body}. Open Power Guard 360 to accept.`, data: { requestId: r.id } },
      trigger: Platform.OS === 'android' ? { channelId: 'maintenance' } : null,
    }).catch(() => {});
  }
  // Drop the banner once the job is accepted or taken away, wherever that happened.
  const shown = useStore.getState().alert;
  if (shown && !mine.some((r) => r.id === shown.requestId)) useStore.setState({ alert: null });
}

export function myJob(plant: PlantState): MaintenanceRequest | undefined {
  return plant.requests.find((r) => r.engineerId === ME && r.status !== 'resolved' && r.status !== 'cancelled');
}

// ---- data link ----

function localTick() {
  const s = useStore.getState();
  if (s.link === 'live') return;
  const plant = step(s.plant, { ...queue, nowMs: Date.now() });
  queue = emptyQueue();
  useStore.setState({ plant });
  notifyAssignments(plant);
}

function connect() {
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    if (stopped) return;
    const ws = new WebSocket(SERVER);
    socket = ws;
    const giveUp = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close(); }, 3000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'phone', engineerId: ME, token: PHONE_TOKEN }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as { type: string; plant?: PlantState };
      if (msg.type !== 'state' || !msg.plant) return;
      useStore.setState({ plant: msg.plant, link: 'live' });
      notifyAssignments(msg.plant);
    };
    ws.onclose = () => {
      clearTimeout(giveUp);
      if (socket === ws) socket = null;
      useStore.setState({ link: 'local' });
      if (!stopped) retry = setTimeout(open, 4000);
    };
    ws.onerror = () => {};
  };
  open();
  return () => { stopped = true; if (retry) clearTimeout(retry); socket?.close(); };
}

export function startClock() {
  const stopLink = connect();
  const id = setInterval(localTick, 1000);
  return () => { clearInterval(id); stopLink(); };
}
