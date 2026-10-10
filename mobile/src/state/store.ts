import * as Location from 'expo-location';
import { create } from 'zustand';

import { createPlant, haversineKm, step } from '@engine/sim/engine';
import type { PlantState } from '@engine/types';

// Same scale as the website: walking 1 m moves the trailer 100 m along its route.
export const PHONE_GPS_SCALE = 100;

export interface PhoneGps {
  shipmentId: string;
  status: 'waiting' | 'tracking' | 'denied' | 'unavailable';
  walkedM: number;
  accuracyM: number | null;
}

interface Store {
  plant: PlantState;
  selected: string | null;
  pendingTrips: string[];
  pendingResets: string[];
  phoneGps: PhoneGps | null;
  pendingGpsKm: number;
  pendingRelease: string[];
  select: (id: string | null) => void;
  trip: (id: string) => void;
  reset: (id: string) => void;
  startPhoneGps: (shipmentId: string) => Promise<void>;
  stopPhoneGps: () => void;
  tick: () => void;
}

let watcher: Location.LocationSubscription | null = null;

export const useStore = create<Store>((set, get) => ({
  plant: createPlant(),
  selected: null,
  pendingTrips: [],
  pendingResets: [],
  phoneGps: null,
  pendingGpsKm: 0,
  pendingRelease: [],
  select: (selected) => set({ selected }),
  trip: (id) => set((s) => ({ pendingTrips: [...s.pendingTrips, id] })),
  reset: (id) => set((s) => ({ pendingResets: [...s.pendingResets, id] })),
  startPhoneGps: async (shipmentId) => {
    get().stopPhoneGps();
    set({ phoneGps: { shipmentId, status: 'waiting', walkedM: 0, accuracyM: null } });
    const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
    if (!perm || perm.status !== 'granted') {
      set({ phoneGps: { shipmentId, status: 'denied', walkedM: 0, accuracyM: null } });
      return;
    }
    let last: [number, number] | null = null;
    try {
      watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
        (pos) => {
          const g = get().phoneGps;
          if (!g || g.shipmentId !== shipmentId) return;
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
          set({
            phoneGps: { ...g, status: 'tracking', walkedM: g.walkedM + stepM, accuracyM: acc },
            pendingGpsKm: get().pendingGpsKm + (stepM * PHONE_GPS_SCALE) / 1000,
          });
        },
      );
    } catch {
      set({ phoneGps: { shipmentId, status: 'unavailable', walkedM: 0, accuracyM: null } });
    }
  },
  stopPhoneGps: () => {
    watcher?.remove();
    watcher = null;
    const g = get().phoneGps;
    set({ phoneGps: null, pendingGpsKm: 0, pendingRelease: g ? [...get().pendingRelease, g.shipmentId] : get().pendingRelease });
  },
  tick: () => {
    const s = get();
    const plant = step(s.plant, {
      nowMs: Date.now(),
      tripRequests: s.pendingTrips,
      resetRequests: s.pendingResets,
      gpsKm: s.phoneGps?.status === 'tracking' ? [{ shipmentId: s.phoneGps.shipmentId, km: s.pendingGpsKm }] : undefined,
      gpsRelease: s.pendingRelease,
    });
    set({ plant, pendingTrips: [], pendingResets: [], pendingGpsKm: 0, pendingRelease: [] });
  },
}));

export function startClock() {
  const id = setInterval(() => useStore.getState().tick(), 1000);
  return () => clearInterval(id);
}
