import { create } from "zustand";
import { createPlant, haversineKm, step } from "./sim/engine";
import type { PlantState, SensorReading } from "./types";

export type View = "twin" | "dashboard" | "map";

// Walking 1 m moves the trailer 100 m along its route, so a phone carried around a room shows real movement.
export const PHONE_GPS_SCALE = 100;

export interface PhoneGps {
  shipmentId: string;
  status: "waiting" | "tracking" | "denied" | "unavailable";
  walkedM: number;
  accuracyM: number | null;
}

interface Store {
  plant: PlantState;
  view: View;
  selected: string | null;
  paused: boolean;
  pendingTrips: string[];
  pendingResets: string[];
  sensor: SensorReading | null;
  sensorAtMs: number | undefined;
  phoneGps: PhoneGps | null;
  pendingGpsKm: number;
  pendingRelease: string[];
  startPhoneGps: (shipmentId: string) => void;
  stopPhoneGps: () => void;
  setView: (v: View) => void;
  select: (id: string | null) => void;
  setPaused: (p: boolean) => void;
  trip: (id: string) => void;
  reset: (id: string) => void;
  pushSensor: (r: SensorReading) => void;
  tick: () => void;
  restart: () => void;
}

let watchId: number | null = null;

function viewFromHash(): View {
  const h = location.hash.replace("#", "");
  return h === "dashboard" || h === "map" ? h : "twin";
}

export const useStore = create<Store>((set, get) => ({
  plant: createPlant(),
  view: viewFromHash(),
  selected: null,
  paused: false,
  pendingTrips: [],
  pendingResets: [],
  sensor: null,
  sensorAtMs: undefined,
  phoneGps: null,
  pendingGpsKm: 0,
  pendingRelease: [],
  startPhoneGps: (shipmentId) => {
    get().stopPhoneGps();
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      set({ phoneGps: { shipmentId, status: "unavailable", walkedM: 0, accuracyM: null } });
      return;
    }
    let last: [number, number] | null = null;
    set({ phoneGps: { shipmentId, status: "waiting", walkedM: 0, accuracyM: null } });
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const here: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        const acc = pos.coords.accuracy;
        const g = get().phoneGps;
        if (!g) return;
        let stepM = 0;
        // Ignore jitter smaller than the fix's own accuracy.
        if (last && acc < 40) {
          const d = haversineKm(last, here) * 1000;
          if (d > Math.max(2, acc * 0.5)) { stepM = d; last = here; }
        } else if (!last) {
          last = here;
        }
        set({
          phoneGps: { ...g, status: "tracking", walkedM: g.walkedM + stepM, accuracyM: acc },
          pendingGpsKm: get().pendingGpsKm + (stepM * PHONE_GPS_SCALE) / 1000,
        });
      },
      (err) => {
        const g = get().phoneGps;
        if (g) set({ phoneGps: { ...g, status: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" } });
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
  },
  stopPhoneGps: () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    const g = get().phoneGps;
    set({ phoneGps: null, pendingGpsKm: 0, pendingRelease: g ? [...get().pendingRelease, g.shipmentId] : get().pendingRelease });
  },
  setView: (view) => {
    history.replaceState(null, "", `#${view}`);
    set({ view });
  },
  select: (selected) => set({ selected }),
  setPaused: (paused) => set({ paused }),
  trip: (id) => set((s) => ({ pendingTrips: [...s.pendingTrips, id] })),
  reset: (id) => set((s) => ({ pendingResets: [...s.pendingResets, id] })),
  pushSensor: (r) => set({ sensor: r, sensorAtMs: Date.now() }),
  tick: () => {
    const s = get();
    if (s.paused) return;
    const plant = step(s.plant, {
      sensor: s.sensor,
      sensorAtMs: s.sensorAtMs,
      nowMs: Date.now(),
      tripRequests: s.pendingTrips,
      resetRequests: s.pendingResets,
      gpsKm: s.phoneGps?.status === "tracking" ? [{ shipmentId: s.phoneGps.shipmentId, km: s.pendingGpsKm }] : undefined,
      gpsRelease: s.pendingRelease,
    });
    set({ plant, pendingTrips: [], pendingResets: [], sensor: null, pendingGpsKm: 0, pendingRelease: [] });
  },
  restart: () => set({ plant: createPlant(), pendingTrips: [], pendingResets: [] }),
}));

export function startClock() {
  const id = window.setInterval(() => useStore.getState().tick(), 1000);
  return () => window.clearInterval(id);
}
