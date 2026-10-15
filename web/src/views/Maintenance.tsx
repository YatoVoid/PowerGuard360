import { useState } from "react";
import { useCanControl, useStore } from "../store";
import { useCopilot } from "../copilot";
import { assetLabel } from "../sim/site";
import { DispatchControl, Panel, PriorityChip, RecommendationCard, etaText, fmt, requestStatusText } from "../ui/parts";
import type { MaintenanceRequest } from "../types";

const ASSETS = [
  ...Array.from({ length: 8 }, (_, i) => `GT-0${i + 1}`),
  "acc", "switchyard", "gas", "battery", "datacenter",
];

const SHOWN = 6;

const COLUMNS: { title: string; statuses: MaintenanceRequest["status"][] }[] = [
  { title: "To dispatch", statuses: ["open", "dispatched"] },
  { title: "In progress", statuses: ["en-route", "on-site", "repairing"] },
  { title: "Resolved", statuses: ["resolved", "cancelled"] },
];

function RequestCard({ r }: { r: MaintenanceRequest }) {
  const engineer = useStore((s) => s.plant.engineers.find((e) => e.id === r.engineerId));
  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  const act = useStore((s) => s.act);
  const live = useStore((s) => s.link === "live");
  const canControl = useCanControl();
  const ask = useCopilot((s) => s.ask);
  const done = r.status === "resolved" || r.status === "cancelled";
  return (
    <li className={`req req-${r.priority.toLowerCase()} ${done ? "is-done" : ""}`}>
      <div className="req-top">
        <PriorityChip p={r.priority} />
        <strong>{r.id}</strong>
        <button type="button" className="link" onClick={() => { select(r.asset); setView("twin"); }}>{r.asset.startsWith("GT-") ? r.asset : assetLabel(r.asset)}</button>
        <span className="req-origin">{r.origin === "model" ? "Model advice" : "Manual"}</span>
      </div>
      <p className="req-reason">{r.reason}</p>
      {r.basis && <p className="req-basis">Model: {r.basis.detail}</p>}
      <div className="req-meta">
        <span>{requestStatusText(r)}</span>
        {engineer && <span>{engineer.name}</span>}
        {!done && r.status !== "open" && <span>Fixed in {etaText(r.etaMin)}</span>}
      </div>
      {(r.status === "en-route" || r.status === "dispatched") && (
        <div className="ship-bar" aria-hidden><span style={{ transform: `scaleX(${r.progress})` }} /></div>
      )}
      {r.status === "open" && <DispatchControl r={r} />}
      {!done && (
        <div className="req-actions">
          {live && <button type="button" className="btn btn-quiet" onClick={() => ask(`Explain ${r.id} on ${r.asset}: what is wrong, how urgent is it, and what should the engineer bring?`, r.asset)}>Explain</button>}
          {canControl && <button type="button" className="btn btn-quiet" onClick={() => act({ type: "cancel", requestId: r.id })}>Cancel</button>}
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
  if (!useCanControl()) return <p className="note">View only. The plant manager signs in to raise requests.</p>;
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
      <button type="submit" className="btn btn-primary" disabled={busy}>Raise request</button>
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

function Recommendations() {
  const recs = useStore((s) => s.plant.recommendations);
  const pending = recs.filter((r) => r.status === "pending").sort((a, b) => b.risk - a.risk);
  const declined = recs.filter((r) => r.status === "declined").slice(-3).reverse();
  return (
    <section className="maint-col" aria-label="Recommended maintenance">
      <header><h2>Recommended</h2><span className="tab-count">{pending.length}</span></header>
      {pending.length ? <div className="rec-list">{pending.map((r) => <RecommendationCard key={r.id} rec={r} />)}</div>
        : <p className="empty">Nothing needs maintenance right now. The model checks every turbine and the air sensor watches gas metering, once a second.</p>}
      {declined.length > 0 && (
        <ul className="rec-declined" aria-label="Recently declined">
          {declined.map((r) => <li key={r.id}>{r.id} {r.asset}: declined</li>)}
        </ul>
      )}
    </section>
  );
}

export function MaintenanceView() {
  const requests = useStore((s) => s.plant.requests);
  const t = useStore((s) => s.plant.t);
  const resolved = requests.filter((r) => r.status === "resolved");
  const avgMin = resolved.length ? resolved.reduce((s, r) => s + ((r.resolvedT ?? t) - r.createdT), 0) / resolved.length / 60 : null;
  // Most urgent first, then newest; resolved work sorts newest first so the latest fixes stay on top.
  const sorted = [...requests].sort((a, b) => a.priority.localeCompare(b.priority) || b.createdT - a.createdT);
  const done = (r: MaintenanceRequest) => r.status === "resolved" || r.status === "cancelled";
  sorted.sort((a, b) => (done(a) && done(b) ? (b.resolvedT ?? b.createdT) - (a.resolvedT ?? a.createdT) : 0));
  return (
    <div className="maint">
      <div className="maint-board">
        <Recommendations />
        {COLUMNS.map((c) => {
          const items = sorted.filter((r) => c.statuses.includes(r.status));
          return (
            <section key={c.title} className="maint-col" aria-label={c.title}>
              <header><h2>{c.title}</h2><span className="tab-count">{items.length}</span></header>
              {items.length ? <ul>{items.slice(0, SHOWN).map((r) => <RequestCard key={r.id} r={r} />)}</ul> : <p className="empty">Nothing here.</p>}
              {items.length > SHOWN && <p className="note">{items.length - SHOWN} older not shown.</p>}
            </section>
          );
        })}
      </div>
      <aside className="maint-side">
        <Panel title="Raise a request"><NewRequest /></Panel>
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
