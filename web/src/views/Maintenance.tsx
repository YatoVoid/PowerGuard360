import { useState } from "react";
import { useStore } from "../store";
import { assetLabel } from "../sim/site";
import { Panel, PriorityChip, etaText, fmt, requestStatusText } from "../ui/parts";
import type { MaintenanceRequest } from "../types";

const ASSETS = [
  ...Array.from({ length: 8 }, (_, i) => `GT-0${i + 1}`),
  "acc", "switchyard", "gas", "battery", "datacenter",
];

const COLUMNS: { title: string; statuses: MaintenanceRequest["status"][] }[] = [
  { title: "Needs an engineer", statuses: ["open", "dispatched"] },
  { title: "In progress", statuses: ["en-route", "on-site", "repairing"] },
  { title: "Resolved", statuses: ["resolved", "cancelled"] },
];

function RequestCard({ r }: { r: MaintenanceRequest }) {
  const engineer = useStore((s) => s.plant.engineers.find((e) => e.id === r.engineerId));
  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  const act = useStore((s) => s.act);
  const done = r.status === "resolved" || r.status === "cancelled";
  return (
    <li className={`req req-${r.priority.toLowerCase()} ${done ? "is-done" : ""}`}>
      <div className="req-top">
        <PriorityChip p={r.priority} />
        <strong>{r.id}</strong>
        <button type="button" className="link" onClick={() => { select(r.asset); setView("twin"); }}>{r.asset.startsWith("GT-") ? r.asset : assetLabel(r.asset)}</button>
        <span className="req-origin">{r.origin === "auto" ? "Sensors" : "Manual"}</span>
      </div>
      <p className="req-reason">{r.reason}</p>
      <div className="req-meta">
        <span>{requestStatusText(r)}</span>
        {engineer && <span>{engineer.name}</span>}
        {!done && r.status !== "open" && <span>Fixed in {etaText(r.etaMin)}</span>}
      </div>
      {(r.status === "en-route" || r.status === "dispatched") && (
        <div className="ship-bar" aria-hidden><span style={{ transform: `scaleX(${r.progress})` }} /></div>
      )}
      {!done && (
        <div className="req-actions">
          <button type="button" className="btn btn-quiet" onClick={() => act({ type: "cancel", requestId: r.id })}>Cancel</button>
        </div>
      )}
    </li>
  );
}

function NewRequest() {
  const act = useStore((s) => s.act);
  const requests = useStore((s) => s.plant.requests);
  const [asset, setAsset] = useState("GT-01");
  const [reason, setReason] = useState("");
  const busy = requests.some((r) => r.asset === asset && r.status !== "resolved" && r.status !== "cancelled");
  return (
    <form className="new-req" onSubmit={(e) => { e.preventDefault(); act({ type: "request", asset, reason }); setReason(""); }}>
      <label>
        <span>Asset</span>
        <select value={asset} onChange={(e) => setAsset(e.target.value)}>
          {ASSETS.map((a) => <option key={a} value={a}>{a.startsWith("GT-") ? `Turbine ${a}` : assetLabel(a)}</option>)}
        </select>
      </label>
      <label>
        <span>What should the engineer check?</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={200} placeholder="For example: vibration rising since this morning" />
      </label>
      {busy && <p className="note">This asset already has an open request. Cancel it first to raise a new one.</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>Request engineer</button>
    </form>
  );
}

function Roster() {
  const engineers = useStore((s) => s.plant.engineers);
  const requests = useStore((s) => s.plant.requests);
  const link = useStore((s) => s.link);
  return (
    <ul className="roster">
      {engineers.map((e) => {
        const r = requests.find((x) => x.id === e.requestId);
        return (
          <li key={e.id}>
            <span className={`dot ${e.status === "available" ? "dot-live" : "dot-busy"}`} aria-hidden />
            <div>
              <strong>{e.name}</strong>
              <span>
                {e.status === "available" ? "Available" : `${e.status.replace("-", " ")}${r ? ` on ${r.id} (${r.asset})` : ""}`}
                {e.kind === "phone" && (link === "live" ? ". Uses the phone app." : ". No server connected, so this engineer walks on their own.")}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function MaintenanceView() {
  const requests = useStore((s) => s.plant.requests);
  const t = useStore((s) => s.plant.t);
  const resolved = requests.filter((r) => r.status === "resolved");
  const avgMin = resolved.length ? resolved.reduce((s, r) => s + ((r.resolvedT ?? t) - r.createdT), 0) / resolved.length / 60 : null;
  const sorted = [...requests].sort((a, b) => a.priority.localeCompare(b.priority) || b.createdT - a.createdT);
  return (
    <div className="maint">
      <div className="maint-board">
        {COLUMNS.map((c) => {
          const items = sorted.filter((r) => c.statuses.includes(r.status));
          return (
            <section key={c.title} className="maint-col" aria-label={c.title}>
              <header><h2>{c.title}</h2><span className="tab-count">{items.length}</span></header>
              {items.length ? <ul>{items.map((r) => <RequestCard key={r.id} r={r} />)}</ul> : <p className="empty">Nothing here.</p>}
            </section>
          );
        })}
      </div>
      <aside className="maint-side">
        <Panel title="Request an engineer"><NewRequest /></Panel>
        <Panel title="Engineers"><Roster /></Panel>
        <Panel title="Response">
          <dl className="kv">
            <div><dt>Open requests</dt><dd>{requests.filter((r) => r.status !== "resolved" && r.status !== "cancelled").length}</dd></div>
            <div><dt>Resolved</dt><dd>{resolved.length}</dd></div>
            <div><dt>Average time to fix</dt><dd>{avgMin === null ? "No fixes yet" : `${fmt(avgMin, 1)} min`}</dd></div>
          </dl>
        </Panel>
      </aside>
    </div>
  );
}
