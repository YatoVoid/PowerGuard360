import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Platform, Vibration } from 'react-native';
import { create } from 'zustand';

import { PHONE_ENGINEER, createPlant, haversineKm, step } from '@engine/sim/engine';
import type { MaintenanceRequest, PlantState, StepInputs } from '@engine/types';

// Each metre walked with the phone moves the engineer this many metres across the site,
// so crossing a demo room is enough to reach a turbine.
export const PHONE_GPS_SCALE = 15;
export const ME = PHONE_ENGINEER;

// Over USB, `adb reverse tcp:8787 tcp:8787` makes the laptop's plant server reachable at 127.0.0.1.
const SERVER = process.env.EXPO_PUBLIC_WS_URL ?? 'ws://127.0.0.1:8787/ws';

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

export interface Gps {
  status: 'waiting' | 'tracking' | 'denied' | 'unavailable';
  walkedM: number;
  accuracyM: number | null;
}

export interface Alert { requestId: string; title: string; body: string; priority: MaintenanceRequest['priority'] }

interface Store {
  plant: PlantState;
  link: Link;
  alert: Alert | null;
  dismissAlert: () => void;
  selected: string | null;
  gps: Gps | null;
  select: (id: string | null) => void;
  act: (a: Action) => void;
  trip: (id: string) => void;
  reset: (id: string) => void;
  startGps: () => Promise<void>;
  stopGps: () => void;
}

type Queue = Required<Pick<StepInputs, 'tripRequests' | 'resetRequests' | 'newRequests' | 'cancel' | 'accept' | 'walkM' | 'autoWalk' | 'startRepair'>>;
const emptyQueue = (): Queue => ({ tripRequests: [], resetRequests: [], newRequests: [], cancel: [], accept: [], walkM: [], autoWalk: [], startRepair: [] });
let queue = emptyQueue();
let socket: WebSocket | null = null;
let watcher: Location.LocationSubscription | null = null;

export const useStore = create<Store>((set, get) => ({
  plant: createPlant(),
  link: 'connecting',
  alert: null,
  dismissAlert: () => set({ alert: null }),
  selected: null,
  gps: null,
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
  startGps: async () => {
    get().stopGps();
    set({ gps: { status: 'waiting', walkedM: 0, accuracyM: null } });
    const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
    if (!perm || perm.status !== 'granted') { set({ gps: { status: 'denied', walkedM: 0, accuracyM: null } }); return; }
    let last: [number, number] | null = null;
    try {
      watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
        (pos) => {
          const g = get().gps;
          if (!g) return;
          const here: [number, number] = [pos.coords.longitude, pos.coords.latitude];
          const acc = pos.coords.accuracy ?? 99;
          let stepM = 0;
          // Ignore jitter smaller than the fix's own accuracy.
          if (last && acc < 40) {
            const d = haversineKm(last, here) * 1000;
            if (d > Math.max(2, acc * 0.5)) { stepM = d; last = here; }
          } else if (!last) {
            last = here;
          }
          set({ gps: { status: 'tracking', walkedM: g.walkedM + stepM, accuracyM: acc } });
          // The server caps one step at 40 site metres, so a long stride is sent in pieces.
          let siteM = stepM * PHONE_GPS_SCALE;
          while (siteM > 0) {
            const chunk = Math.min(40, siteM);
            get().act({ type: 'walk', engineerId: ME, meters: chunk });
            siteM -= chunk;
          }
        },
      );
    } catch {
      set({ gps: { status: 'unavailable', walkedM: 0, accuracyM: null } });
    }
  },
  stopGps: () => {
    watcher?.remove();
    watcher = null;
    set({ gps: null });
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
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'phone', engineerId: ME }));
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
