import { lazy, Suspense, useEffect, useState } from "react";
import { startClock, useStore, type CameraPreset, type View } from "./store";
import {
  AlarmList, AssetDetail, BalanceChart, BalanceStats, Panel, PredictionList, SensorPanel, SourceTag, TurbineStrip, UnitLoadBars, clockOf,
} from "./ui/parts";
import { IconBell, IconDashboard, IconMark, IconPlant, IconTag, IconTruck } from "./ui/icons";
import { LIVE_SENSOR_UNIT } from "./sim/engine";

const MapView = lazy(() => import("./views/MapView").then((m) => ({ default: m.MapView })));
const PlantScene = lazy(() => import("./scene/PlantScene").then((m) => ({ default: m.PlantScene })));

const VIEWS: { id: View; label: string; icon: () => React.ReactElement }[] = [
  { id: "twin", label: "Plant", icon: IconPlant },
  { id: "dashboard", label: "Dashboard", icon: IconDashboard },
  { id: "map", label: "Shipments", icon: IconTruck },
];

function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const board = useStore((s) => s.plant.ambient.source);
  return (
    <aside className="side" aria-label="Main">
      <div className="side-brand">
        <IconMark />
        <div>
          <strong>Power Guard 360</strong>
          <span>Plant operations</span>
        </div>
      </div>
      <nav className="side-nav" aria-label="Views">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className="side-link" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="side-foot">
        <div className="side-status">
          <span className={`dot ${board === "live" ? "dot-live" : ""}`} aria-hidden />
          <div>
            <strong>{LIVE_SENSOR_UNIT} sensor board</strong>
            <span>{board === "live" ? "Connected" : "Not connected"}</span>
          </div>
        </div>
        <p className="side-note">Plant data is simulated until the turbine feed is connected.</p>
      </div>
    </aside>
  );
}

function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const t = useStore((s) => s.plant.t);
  const source = useStore((s) => s.plant.ambient.source);
  const alarms = useStore((s) => s.plant.turbines.filter((x) => x.status === "watch" || x.status === "tripped").length);
  const current = VIEWS.find((v) => v.id === view)!;
  return (
    <header className="top">
      <div className="crumbs">
        <span className="crumb-brand"><IconMark /></span>
        <span className="crumb">Permian site</span>
        <span className="crumb-sep" aria-hidden>/</span>
        <span className="crumb">Kilby-style plant</span>
        <span className="crumb-sep" aria-hidden>/</span>
        <h1 className="crumb crumb-current">{current.label}</h1>
      </div>
      <div className="top-meta">
        <span className="realtime"><span className="dot dot-live" aria-hidden />Realtime</span>
        <SourceTag source={source} />
        <time className="clock" aria-label="Plant time">{clockOf(t)}</time>
        <button type="button" className={`bell ${alarms ? "has-alarms" : ""}`} onClick={() => setView("dashboard")} aria-label={`${alarms} active alarms`}>
          <IconBell />
          {alarms > 0 && <span className="bell-count">{alarms}</span>}
        </button>
      </div>
    </header>
  );
}

const PRESETS: { id: CameraPreset; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "turbines", label: "Turbines" },
  { id: "dock", label: "Dock" },
  { id: "top", label: "Top" },
];

function SceneToolbar() {
  const goTo = useStore((s) => s.goTo);
  const showLabels = useStore((s) => s.showLabels);
  const setShowLabels = useStore((s) => s.setShowLabels);
  return (
    <div className="scene-tools" role="toolbar" aria-label="3D view">
      <div className="seg">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => goTo(p.id)}>{p.label}</button>
        ))}
      </div>
      <button type="button" className={`seg-toggle ${showLabels ? "is-on" : ""}`} aria-pressed={showLabels} onClick={() => setShowLabels(!showLabels)}>
        <IconTag />
        <span>Labels</span>
      </button>
    </div>
  );
}

function Inspector() {
  const selected = useStore((s) => s.selected);
  const events = useStore((s) => s.plant.events);
  const [tab, setTab] = useState<"asset" | "events">("asset");
  const shown = selected ? events.filter((e) => e.asset === selected) : events;
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="insp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "asset"} onClick={() => setTab("asset")}>Asset</button>
        <button type="button" role="tab" aria-selected={tab === "events"} onClick={() => setTab("events")}>
          Events{shown.length ? <span className="tab-count">{shown.length}</span> : null}
        </button>
      </div>
      <div className="insp-body" role="tabpanel">
        {tab === "asset" ? <AssetDetail /> : <AlarmList events={shown} limit={20} empty={selected ? `Nothing logged for ${selected} yet.` : "No events yet."} />}
      </div>
    </aside>
  );
}

function TwinView() {
  const showLabels = useStore((s) => s.showLabels);
  return (
    <div className="twin">
      <div className="kpi-row"><BalanceStats /></div>
      <div className={`scene ${showLabels ? "" : "labels-off"}`}>
        <Suspense fallback={<div className="scene-loading">Loading plant model</div>}>
          <PlantScene />
        </Suspense>
        <SceneToolbar />
        <p className="scene-hint"><span className="hint-mouse">Drag to orbit, scroll to zoom, click any asset</span><span className="hint-touch">Drag to orbit, pinch to zoom, tap any asset</span></p>
      </div>
      <Inspector />
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
      <div className="d-kpis kpi-row"><BalanceStats /></div>
      <Panel title="Power balance" meta="Last 5 minutes" className="d-balance"><BalanceChart history={history} /></Panel>
      <Panel title="Alarms and events" meta={`${events.length} logged`} className="d-alarms"><AlarmList events={events} limit={12} /></Panel>
      <Panel title="Unit load" meta="Share of rated output" className="d-load"><UnitLoadBars /></Panel>
      <Panel title="Turbine fleet" className="d-fleet"><TurbineStrip /></Panel>
      <Panel title="Selected unit" className="d-detail"><AssetDetail /></Panel>
      <Panel title="Overheat forecast" className="d-pred"><PredictionList /></Panel>
      <Panel title={`${LIVE_SENSOR_UNIT} sensor board`} aside={<SourceTag source={source} />} className="d-sensors"><SensorPanel /></Panel>
    </div>
  );
}

export default function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  useEffect(() => startClock(), []);
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.replace("#", "");
      useStore.getState().setView(h === "dashboard" || h === "map" ? h : "twin");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return (
    <div className="app">
      <Sidebar />
      <div className="main-col">
        <TopBar />
        <main className="main">
          {view === "twin" && <TwinView />}
          {view === "dashboard" && <DashboardView />}
          {view === "map" && <Suspense fallback={<p className="empty">Loading map</p>}><MapView /></Suspense>}
        </main>
      </div>
      <nav className="tabs" aria-label="Views">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className="tab" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
