import { lazy, Suspense, useEffect } from "react";
import { startClock, useStore, type View } from "./store";
import {
  AlarmList, AssetDetail, BalanceChart, BalanceStats, Panel, PredictionList, SensorPanel, SourceTag, TurbineStrip, clockOf,
} from "./ui/parts";
const MapView = lazy(() => import("./views/MapView").then((m) => ({ default: m.MapView })));

const PlantScene = lazy(() => import("./scene/PlantScene").then((m) => ({ default: m.PlantScene })));

const VIEWS: { id: View; label: string }[] = [
  { id: "twin", label: "Plant" },
  { id: "dashboard", label: "Dashboard" },
  { id: "map", label: "Shipments" },
];

function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const t = useStore((s) => s.plant.t);
  const source = useStore((s) => s.plant.ambient.source);
  const alarms = useStore((s) => s.plant.turbines.filter((x) => x.status === "watch" || x.status === "tripped").length);
  return (
    <header className="top">
      <div className="brand">
        <svg viewBox="0 0 32 32" aria-hidden className="mark"><path d="M9 23V12l7-4 7 4v11" /><path d="M17 12l-3 6h4l-3 6" className="bolt" /></svg>
        <div>
          <h1>Always On</h1>
          <p>Gas-turbine plant for an AI data center, West Texas</p>
        </div>
      </div>
      <nav className="tabs" aria-label="Views">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className="tab" aria-current={view === v.id ? "page" : undefined} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>
      <div className="top-meta">
        {alarms > 0 && <span className="alarm-count">{alarms} {alarms === 1 ? "alarm" : "alarms"}</span>}
        <SourceTag source={source} />
        <time className="clock">{clockOf(t)}</time>
      </div>
    </header>
  );
}

function TwinView() {
  const events = useStore((s) => s.plant.events);
  return (
    <div className="twin">
      <div className="scene">
        <Suspense fallback={<div className="scene-loading">Loading plant model</div>}>
          <PlantScene />
        </Suspense>
        <p className="scene-hint">Drag to orbit, scroll to zoom, click any unit</p>
      </div>
      <aside className="rail">
        <Panel title="Power balance"><BalanceStats /></Panel>
        <Panel title="Selected"><AssetDetail /></Panel>
        <Panel title="Alarms and events"><AlarmList events={events} limit={6} /></Panel>
      </aside>
      <div className="fleet"><TurbineStrip /></div>
    </div>
  );
}

function DashboardView() {
  const history = useStore((s) => s.plant.history);
  const events = useStore((s) => s.plant.events);
  const source = useStore((s) => s.plant.ambient.source);
  return (
    <div className="dash">
      <Panel title="Power balance" className="d-balance">
        <BalanceStats />
        <BalanceChart history={history} />
      </Panel>
      <Panel title="Turbine fleet" className="d-fleet"><TurbineStrip /></Panel>
      <Panel title="Selected" className="d-detail"><AssetDetail /></Panel>
      <Panel title="Overheat forecast" className="d-pred"><PredictionList /></Panel>
      <Panel title="Site sensors" aside={<SourceTag source={source} />} className="d-sensors"><SensorPanel /></Panel>
      <Panel title="Alarms and events" className="d-alarms"><AlarmList events={events} limit={12} /></Panel>
    </div>
  );
}

export default function App() {
  const view = useStore((s) => s.view);
  useEffect(() => startClock(), []);
  return (
    <div className="app">
      <TopBar />
      <main className="main">
        {view === "twin" && <TwinView />}
        {view === "dashboard" && <DashboardView />}
        {view === "map" && <Suspense fallback={<p className="empty">Loading map</p>}><MapView /></Suspense>}
      </main>
    </div>
  );
}
