import { lazy, Suspense, useEffect, useState } from "react";
import { startClock, useStore, type CameraPreset, type View } from "./store";
import {
  AlarmList, AssetDetail, BalanceChart, BalanceStats, Panel, PredictionList, PriorityChip, SensorPanel, SourceTag, TurbineStrip, UnitLoadBars, clockOf, requestStatusText,
} from "./ui/parts";
import { BrandMark, IconBell, IconDashboard, IconInfo, IconPlant, IconTag, IconWrench } from "./ui/icons";
import { MaintenanceView } from "./views/Maintenance";
import { AboutView } from "./views/About";
import { LIVE_SENSOR_UNIT } from "./sim/engine";
import { CopilotButton, CopilotPanel } from "./ui/Copilot";
import { signIn, signInOffered, signOut } from "./auth";
import { LogoLoader, LogoMark } from "./ui/LogoLoader";

const PlantScene = lazy(() => import("./scene/PlantScene").then((m) => ({ default: m.PlantScene })));

const VIEWS: { id: View; label: string; icon: () => React.ReactElement }[] = [
  { id: "twin", label: "Plant", icon: IconPlant },
  { id: "dashboard", label: "Dashboard", icon: IconDashboard },
  { id: "maintenance", label: "Maintenance", icon: IconWrench },
  { id: "about", label: "About", icon: IconInfo },
];

function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const board = useStore((s) => s.plant.board.source);
  const gas = useStore((s) => s.plant.gas);
  return (
    <aside className="side" aria-label="Main">
      <div className="side-brand">
        <BrandMark size={34} variant="reverse" />
        <div>
          <strong>Power Guard <em>360</em></strong>
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
        <div className="side-status">
          <span className={`dot ${gas.connected ? (gas.level === "poor" ? "dot-busy" : "dot-live") : ""}`} aria-hidden />
          <div>
            <strong>Gas metering air sensor</strong>
            <span>{gas.connected ? `Air quality ${gas.qualityPct}%${gas.level === "poor" ? ", possible leak" : ""}` : "Not connected"}</span>
          </div>
        </div>
        <p className="side-note">GT-01 to GT-07 replay the AI4I 2020 dataset. GT-08 replays it too until the board connects.</p>
      </div>
    </aside>
  );
}

function LinkStatus() {
  const link = useStore((s) => s.link);
  const text = link === "live" ? "Live: plant server" : link === "connecting" ? "Connecting" : "Local simulation";
  return (
    <span className="realtime" title={link === "live" ? "Shared with every connected screen and phone" : "No plant server reachable. This page runs its own copy."}>
      {link === "connecting" ? <LogoMark size={16} /> : <span className={`dot ${link === "live" ? "dot-live" : ""}`} aria-hidden />}{text}
    </span>
  );
}

// Visitors see the live plant read-only. The plant manager signs in here to take control.
function AdminAccess() {
  const link = useStore((s) => s.link);
  const role = useStore((s) => s.role);
  const [offered, setOffered] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (link === "live") signInOffered().then(setOffered); }, [link]);
  if (link !== "live") return null;
  if (role === "admin") {
    return <button type="button" className="btn btn-quiet admin-btn" onClick={() => signOut()} title="Signed in as plant manager"><span className="admin-long">Admin · </span>Sign out</button>;
  }
  if (!offered) return <span className="realtime" title="Sign in as admin to control the plant">View only</span>;
  return (
    <div className="admin">
      <button type="button" className="btn btn-quiet admin-btn" aria-expanded={open} onClick={() => { setOpen(!open); setError(null); }}><span className="admin-long">View only · </span>Sign in</button>
      {open && (
        <form className="admin-form" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const err = await signIn(password);
          setBusy(false);
          setError(err);
          if (!err) { setOpen(false); setPassword(""); }
        }}>
          <label htmlFor="admin-password">Admin password</label>
          <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} autoFocus />
          {error && <p className="admin-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy || !password}>{busy ? <LogoLoader inline size={18} label="Signing in" /> : "Sign in"}</button>
        </form>
      )}
    </div>
  );
}

function MaintSummary() {
  const requests = useStore((s) => s.plant.requests);
  const setView = useStore((s) => s.setView);
  const open = requests.filter((r) => r.status !== "resolved" && r.status !== "cancelled");
  return (
    <>
      {open.length === 0 ? <p className="empty">No open maintenance requests. Sensors are watching every unit.</p> : (
        <ul className="maint-mini">
          {open.slice(0, 5).map((r) => (
            <li key={r.id}>
              <PriorityChip p={r.priority} />
              <strong>{r.asset}</strong>
              <span>{requestStatusText(r)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="actions"><button type="button" className="btn" onClick={() => setView("maintenance")}>Open maintenance</button></div>
    </>
  );
}

function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const t = useStore((s) => s.plant.t);
  const alarms = useStore((s) => s.plant.requests.filter((r) => r.status !== "resolved" && r.status !== "cancelled").length
    + s.plant.recommendations.filter((r) => r.status === "pending").length);
  const current = VIEWS.find((v) => v.id === view)!;
  return (
    <header className="top">
      <div className="crumbs">
        <span className="crumb-brand"><BrandMark size={28} /></span>
        <span className="crumb">Permian site</span>
        <span className="crumb-sep" aria-hidden>/</span>
        <span className="crumb">Kilby-style plant</span>
        <span className="crumb-sep" aria-hidden>/</span>
        <h1 className="crumb crumb-current">{current.label}</h1>
      </div>
      <div className="top-meta">
        <LinkStatus />
        <AdminAccess />
        <time className="clock" aria-label="Plant time">{clockOf(t)}</time>
        <CopilotButton />
        <button type="button" className={`bell ${alarms ? "has-alarms" : ""}`} onClick={() => setView("maintenance")} aria-label={`${alarms} maintenance recommendations and open requests`}>
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
  { id: "control", label: "Control room" },
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
        <Suspense fallback={<div className="scene-loading"><LogoLoader label="Loading plant model" /></div>}>
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
  const source = useStore((s) => s.plant.board.source);
  const setView = useStore((s) => s.setView);
  return (
    <div className="dash">
      <section className="d-intro" aria-label="About this project">
        <img src={`${import.meta.env.BASE_URL}about/gas-plant.jpg`} alt="" />
        <div>
          <h2>New here? This is a live model of a power plant for an AI data center.</h2>
          <p>It's modeled on Project Kilby, the West Texas gas plant Chevron agreed in June 2026 to build for a Microsoft data center. Find out what's going on and why we built it, in plain English.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setView("about")}>Read about the project</button>
      </section>
      <div className="d-kpis kpi-row"><BalanceStats /></div>
      <Panel title="Power balance" meta="Last 5 minutes" className="d-balance"><BalanceChart history={history} /></Panel>
      <Panel title="Alarms and events" meta={`${events.length} logged`} className="d-alarms"><AlarmList events={events} limit={12} /></Panel>
      <Panel title="Unit load" meta="Share of rated output" className="d-load"><UnitLoadBars /></Panel>
      <Panel title="Turbine fleet" className="d-fleet"><TurbineStrip /></Panel>
      <Panel title="Selected unit" className="d-detail"><AssetDetail /></Panel>
      <Panel title="Failure forecast" className="d-pred"><PredictionList /></Panel>
      <Panel title="Maintenance" meta="Open requests" className="d-maint"><MaintSummary /></Panel>
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
      useStore.getState().setView(h === "dashboard" || h === "maintenance" || h === "about" ? h : "twin");
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
          {view === "maintenance" && <MaintenanceView />}
          {view === "about" && <AboutView />}
        </main>
      </div>
      <CopilotPanel />
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
