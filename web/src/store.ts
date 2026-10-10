import { create } from "zustand";
import { createPlant, step } from "./sim/engine";
import type { PlantState, SensorReading } from "./types";

export type View = "twin" | "dashboard" | "map";

interface Store {
  plant: PlantState;
  view: View;
  selected: string | null;
  paused: boolean;
  pendingTrips: string[];
  pendingResets: string[];
  sensor: SensorReading | null;
  sensorAtMs: number | undefined;
  setView: (v: View) => void;
  select: (id: string | null) => void;
  setPaused: (p: boolean) => void;
  trip: (id: string) => void;
  reset: (id: string) => void;
  pushSensor: (r: SensorReading) => void;
  tick: () => void;
  restart: () => void;
}

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
    });
    set({ plant, pendingTrips: [], pendingResets: [], sensor: null });
  },
  restart: () => set({ plant: createPlant(), pendingTrips: [], pendingResets: [] }),
}));

export function startClock() {
  const id = window.setInterval(() => useStore.getState().tick(), 1000);
  return () => window.clearInterval(id);
}
