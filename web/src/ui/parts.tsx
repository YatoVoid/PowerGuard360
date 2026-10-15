import { useEffect, useRef, useState } from "react";
import { useCanControl, useStore } from "../store";
import { GAS_ALERT_PCT, GAS_WARMUP_SAMPLES, LIVE_SENSOR_UNIT, REPAIR_S, WATCH_RISK } from "../sim/engine";
import { FAILURE_NAME, modelNote } from "../sim/model";
import type { Features, HistoryPoint, MaintenanceRequest, MlDiagnosis, PlantEvent, Recommendation, Source, Turbine } from "../types";
import { assetLabel, pathLength, routeFrom } from "../sim/site";
import { useCopilot } from "../copilot";

export const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function clockOf(t: number) {
  const base = new Date();
  base.setHours(14, 0, 0, 0);
  return new Date(base.getTime() + t * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function SourceTag({ source }: { source: Source }) {
  return <span className={`src src-${source}`}>{source === "live" ? "Live sensor" : "Simulated"}</span>;
}

export function Panel({ title, meta, aside, children, className = "" }: { title: string; meta?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        {meta && <span className="panel-meta">{meta}</span>}
        {aside}
      </header>
      {children}
    </section>
  );
}

const SERIES: { key: keyof HistoryPoint; label: string; cls: string }[] = [
  { key: "demandMw", label: "Data center demand", cls: "s-demand" },
  { key: "outputMw", label: "Turbine output", cls: "s-output" },
  { key: "batteryMw", label: "Battery", cls: "s-battery" },
  { key: "gridMw", label: "Grid import", cls: "s-grid" },
];

// Drawn at the container's real pixel size so axis text stays the same size on every screen.
export function BalanceChart({ history }: { history: HistoryPoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 220 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(200, e.contentRect.width), h: Math.max(120, e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { w, h } = size;
  const pad = { l: 46, r: 10, t: 10, b: 22 };
  const max = 2700, min = 0;
  const n = Math.max(history.length, 2);
  const x = (i: number) => pad.l + (i / (n - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  const ticks = [0, 900, 1800, 2700];
  return (
    <figure className="chart">
      <div ref={box} className="chart-box">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Power balance, last five minutes">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="grid" />
              <text x={pad.l - 8} y={y(v) + 4} className="axis" textAnchor="end">{fmt(v)}</text>
            </g>
          ))}
          {SERIES.map((s) => (
            <polyline
              key={s.key}
              className={`line ${s.cls}`}
              points={history.map((p, i) => `${x(i)},${y(Math.max(0, p[s.key] as number))}`).join(" ")}
            />
          ))}
          <text x={w - pad.r} y={h - 4} className="axis" textAnchor="end">now</text>
          <text x={pad.l} y={h - 4} className="axis">5 min ago</text>
        </svg>
      </div>
      <figcaption className="legend">
        {SERIES.map((s) => <span key={s.key} className={`key ${s.cls}`}>{s.label}</span>)}
        <span className="legend-unit">MW</span>
      </figcaption>
    </figure>
  );
}

export function Spark({ values, lo, hi, warn }: { values: number[]; lo: number; hi: number; warn?: number }) {
  const w = 120, h = 28;
  if (values.length < 2) return <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden />;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * h;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      {warn !== undefined && <line x1={0} x2={w} y1={y(warn)} y2={y(warn)} className="spark-warn" />}
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
    </svg>
  );
}

export function BalanceStats() {
  const p = useStore((s) => s.plant);
  const batt = p.battery.powerMw;
  return (
    <dl className="stats">
      <div><dt>Demand</dt><dd>{fmt(p.demandMw)}<small> MW</small></dd></div>
      <div><dt>Turbines</dt><dd>{fmt(p.outputMw)}<small> MW</small></dd></div>
      <div className={batt > 5 ? "is-active" : ""}>
        <dt>Battery</dt>
        <dd>{batt > 5 ? `${fmt(batt)}` : batt < -5 ? `${fmt(-batt)}` : "0"}<small> MW {batt > 5 ? "out" : batt < -5 ? "in" : ""}</small></dd>
      </div>
      <div className={p.gridMw > 1 ? "is-watch" : ""}><dt>Grid import</dt><dd>{fmt(p.gridMw)}<small> MW</small></dd></div>
      <div><dt>Reserve</dt><dd>{fmt(p.reserveMw)}<small> MW</small></dd></div>
      <div><dt>Battery charge</dt><dd>{fmt(p.battery.socPct)}<small> %</small></dd></div>
    </dl>
  );
}

export function UnitLoadBars() {
  const turbines = useStore((s) => s.plant.turbines);
  const select = useStore((s) => s.select);
  return (
    <ul className="loadbars">
      {turbines.map((tb) => {
        const pct = (tb.outputMw / tb.ratedMw) * 100;
        const cap = (tb.capacityMw / tb.ratedMw) * 100;
        return (
          <li key={tb.id}>
            <button type="button" onClick={() => select(tb.id)} className={`loadbar loadbar-${tb.status}`}>
              <span className="loadbar-id">{tb.id}</span>
              <span className="loadbar-track" aria-hidden>
                <span className="loadbar-fill" style={{ transform: `scaleX(${pct / 100})` }} />
                <span className="loadbar-cap" style={{ left: `${cap}%` }} title="Available capacity at current inlet air" />
              </span>
              <span className="loadbar-val">{fmt(pct, 1)}%</span>
            </button>
          </li>
        );
      })}
      <li className="loadbar-legend" aria-hidden><span className="cap-key" />Available capacity at current inlet air</li>
    </ul>
  );
}

const K = 273.15;
const kAndC = (k: number) => `${fmt(k, 1)} K (${fmt(k - K, 1)} °C)`;

export const FEATURE_ROWS: { key: keyof Features; label: string; show: (f: Features) => string }[] = [
  { key: "airTempK", label: "Air temperature", show: (f) => kAndC(f.airTempK) },
  { key: "processTempK", label: "Process temperature", show: (f) => kAndC(f.processTempK) },
  { key: "rpm", label: "Rotational speed", show: (f) => `${fmt(f.rpm)} rpm` },
  { key: "torqueNm", label: "Torque", show: (f) => `${fmt(f.torqueNm, 1)} Nm` },
  { key: "toolWearMin", label: "Tool wear", show: (f) => `${fmt(f.toolWearMin)} min` },
];

// `live` marks the readings the sensor board measured; a partial reading shows "Not sent" for the rest.
export function FeatureList({ f, live }: { f: Partial<Features>; live?: (keyof Features)[] }) {
  return (
    <dl className="kv">
      <div><dt>Type (quality grade)</dt><dd>{f.type ?? "Not sent"}</dd></div>
      {FEATURE_ROWS.map((r) => (
        <div key={r.key}>
          <dt>{r.label}{live?.includes(r.key) && <span className="live-tag">Live</span>}</dt>
          <dd className={f[r.key] === undefined ? "muted" : undefined}>{f[r.key] === undefined ? "Not sent" : r.show(f as Features)}</dd>
        </div>
      ))}
    </dl>
  );
}

const featureNames = (keys: (keyof Features)[]) => keys.map((k) => FEATURE_ROWS.find((r) => r.key === k)!.label.toLowerCase()).join(", ");

const FACTOR_LABEL: Record<string, string> = {
  "Air temperature [K]": "Air temperature", "Process temperature [K]": "Process temperature",
  "Rotational speed [rpm]": "Speed", "Torque [Nm]": "Torque", "Tool wear [min]": "Tool wear", Type: "Machine type",
};

function FactorList({ factors }: { factors: NonNullable<MlDiagnosis["factors"]> }) {
  return (
    <ul className="ml-factors" aria-label="Inputs that moved the risk most">
      {factors.map((f) => (
        <li key={f.feature}>
          <span>{FACTOR_LABEL[f.feature] ?? f.feature} <span className="muted">{typeof f.value === "number" ? `${fmt(f.value, Number.isInteger(f.value) ? 0 : 1)} ${f.feature.match(/\[(.+)\]/)?.[1] ?? ""}` : f.value}</span></span>
          <span className={f.contribution > 0 ? "up" : "down"}>{f.contribution > 0 ? "+" : "−"}{Math.abs(Math.round(f.contribution * 100))} pts</span>
        </li>
      ))}
    </ul>
  );
}

// A model recommendation waiting on the manager: why the model flagged the unit, and the manager's call.
export function RecommendationCard({ rec, compact = false }: { rec: Recommendation; compact?: boolean }) {
  const act = useStore((s) => s.act);
  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  const [note, setNote] = useState(rec.action);
  const canControl = useCanControl();
  const level = rec.alertLevel === "Critical" ? "p1" : rec.alertLevel === "Alert" ? "p2" : "p3";
  return (
    <article className={`rec rec-${level}`} aria-label={`${rec.id} maintenance recommended for ${rec.asset}`}>
      <div className="req-top">
        <span className={`prio prio-${level}`}>{rec.alertLevel}</span>
        {compact ? <strong>{rec.id}</strong> : (
          <>
            <strong>{rec.id}</strong>
            <button type="button" className="link" onClick={() => { select(rec.asset); setView("twin"); }}>{rec.asset.startsWith("GT-") ? rec.asset : assetLabel(rec.asset)}</button>
          </>
        )}
        <span className="req-origin">{Math.round(rec.risk * 100)}% risk</span>
      </div>
      <p className="req-reason">{rec.detail}</p>
      {rec.types.length > 0 && (
        <p className="rec-types">Possible: {rec.types.map((x) => `${x.name.toLowerCase()} (${Math.round(x.probability * 100)}%)`).join(", ")}</p>
      )}
      {rec.factors && <FactorList factors={rec.factors} />}
      {!canControl ? <p className="note">Waiting for the plant manager's decision.</p> : <form className="rec-form" onSubmit={(e) => { e.preventDefault(); act({ type: "review", recommendationId: rec.id, decision: "request", note }); }}>
        <label htmlFor={`note-${rec.id}`}>What should the engineer check?</label>
        <textarea id={`note-${rec.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={compact ? 2 : 3} maxLength={200} />
        <div className="rec-actions">
          <button type="button" className="btn btn-quiet" onClick={() => act({ type: "review", recommendationId: rec.id, decision: "decline", note: "" })}>Decline</button>
          <button type="submit" className="btn btn-primary">Request maintenance</button>
        </div>
      </form>}
      <p className="hint">{rec.by} recommendation. Declining silences this issue until the reading recovers; if it comes back or gets worse, you'll be asked again.</p>
    </article>
  );
}

function MlDiagnosisPanel({ ml, title = "Model diagnosis" }: { ml: MlDiagnosis; title?: string }) {
  const urgent = ml.alertLevel === "Alert" || ml.alertLevel === "Critical";
  return (
    <section className="ml" aria-label={title}>
      <h4 className="sub">{title}</h4>
      <dl className="kv">
        <div className={urgent ? "is-watch" : undefined}><dt>Alert level</dt><dd>{ml.alertLevel}</dd></div>
        <div>
          <dt>Failure type</dt>
          <dd className={ml.failureClass ? undefined : "muted"}>
            {ml.failureClass
              ? ml.types.length ? ml.types.map((t) => `${t.name} ${Math.round(t.probability * 100)}%`).join(", ") : "Unclear, no type above 50%"
              : `None, risk under ${Math.round(ml.threshold * 100)}%`}
          </dd>
        </div>
      </dl>
      {ml.factors && <FactorList factors={ml.factors} />}
      {urgent && <p className="ml-action">{ml.action}</p>}
    </section>
  );
}

export function TurbineDetail({ tb }: { tb: Turbine }) {
  const risk = useStore((s) => s.plant.riskHistory[tb.id] ?? []);
  const pred = useStore((s) => s.plant.predictions.find((p) => p.turbineId === tb.id));
  const trip = useStore((s) => s.trip);
  const reset = useStore((s) => s.reset);
  const canControl = useCanControl();
  const canTrip = canControl && (tb.status === "running" || tb.status === "watch");
  const live = useStore((s) => s.link === "live");
  const ask = useCopilot((s) => s.ask);
  const question = tb.status === "tripped" ? `Why did ${tb.id} trip, and what should the engineer check?`
    : pred && pred.risk >= 0.2 ? `Why is ${tb.id} at risk, and what should we do?`
    : `How is ${tb.id} doing?`;
  return (
    <div className="detail">
      <div className="detail-head">
        <h3>{tb.id}</h3>
        <span className={`status status-${tb.status}`}>{tb.status}</span>
      </div>
      {tb.tripCause && <p className="cause">{tb.tripCause}</p>}
      <dl className="kv">
        <div><dt>Electrical output</dt><dd>{fmt(tb.outputMw)} / {fmt(tb.capacityMw)} MW</dd></div>
        <div><dt>Shaft power (torque × speed)</dt><dd>{fmt(tb.shaftPowerKw, 2)} kW</dd></div>
      </dl>
      <div className="sensor-head">
        <h4 className="sub">Machine readings</h4>
        <SourceTag source={tb.source} />
      </div>
      <FeatureList f={tb.features} live={tb.measured} />
      <p className="note">
        {tb.source === "live"
          ? tb.measured.length === FEATURE_ROWS.length
            ? "All readings measured live by the sensor board."
            : `Live from the sensor board: ${featureNames(tb.measured)}. The rest replays dataset row ${tb.row === null ? "" : (tb.row + 1).toLocaleString("en-US")}.`
          : `Dataset row ${tb.row === null ? "" : (tb.row + 1).toLocaleString("en-US")} of the AI4I 2020 data.`}
        {tb.id === LIVE_SENSOR_UNIT && tb.source === "sim" && " Connect the sensor board to drive these readings live."}
      </p>
      <div className="trend-row">
        <span>Failure risk, last 3 min</span>
        <Spark values={risk} lo={0} hi={1} warn={WATCH_RISK} />
      </div>
      {pred && pred.risk >= 0.2 && <p className="forecast">{pred.detail}</p>}
      {live && <button type="button" className="link forecast-ask" onClick={() => ask(question, tb.id)}>Ask Copilot: {question}</button>}
      {pred && (
        <p className="note">{pred.by}: {Math.round(pred.probability * 100)}% failure probability on this reading.</p>
      )}
      {pred?.ml && <MlDiagnosisPanel ml={pred.ml} />}
      {tb.status === "tripped" && tb.diagnosis && <MlDiagnosisPanel ml={tb.diagnosis} title="Model diagnosis of the trip reading" />}
      <div className="actions">
        {canTrip && <button type="button" className="btn btn-danger" onClick={() => trip(tb.id)}>Trip {tb.id}</button>}
        {canControl && tb.status === "tripped" && <button type="button" className="btn" onClick={() => reset(tb.id)}>Reset and restart</button>}
      </div>
    </div>
  );
}

const assetName = (asset: string) => (asset.startsWith("GT-") ? asset : assetLabel(asset));

// Recommendations still waiting for the manager, most urgent first. They outlive the reading that raised
// them, so the plant view has to show them on their own rather than through the current risk ranking.
function usePendingRecs() {
  const recs = useStore((s) => s.plant.recommendations);
  return recs.filter((r) => r.status === "pending").sort((a, b) => b.risk - a.risk || b.createdT - a.createdT);
}

function PendingStrip({ shown }: { shown: string }) {
  const select = useStore((s) => s.select);
  const others = usePendingRecs().filter((r) => r.asset !== shown);
  if (!others.length) return null;
  return (
    <div className="pending-strip" role="status">
      <strong>{others.length === 1 ? "Maintenance recommended" : `${others.length} maintenance recommendations`}</strong>
      <span>
        {others.map((r) => (
          <button key={r.id} type="button" className="link" onClick={() => select(r.asset)}>{assetName(r.asset)} ({Math.round(r.risk * 100)}%)</button>
        ))}
      </span>
    </div>
  );
}

export function AssetDetail() {
  const selected = useStore((s) => s.selected);
  const riskiest = useStore((s) => s.plant.predictions[0]?.turbineId ?? "GT-01");
  const waiting = usePendingRecs()[0];
  // A request nobody has been sent to yet comes next, otherwise approving a non-turbine
  // recommendation would jump the panel to a turbine and hide the Dispatch control.
  const undispatched = useStore((s) => s.plant.requests.find((r) => r.status === "open"));
  const asset = selected ?? waiting?.asset ?? undispatched?.asset ?? riskiest;
  const hint = waiting ? `${waiting.id} is waiting for your decision on ${assetName(waiting.asset)}.`
    : undispatched ? `${undispatched.id} on ${assetName(undispatched.asset)} needs an engineer.`
    : "Showing the unit most at risk.";
  return (
    <>
      <PendingStrip shown={asset} />
      {!selected && <p className="hint">{hint} Click any unit to switch.</p>}
      <AssetBody asset={asset} />
      <MaintenanceBox asset={asset} />
    </>
  );
}

const STATUS_TEXT: Record<MaintenanceRequest["status"], string> = {
  open: "Waiting for an engineer",
  dispatched: "Sent to engineer, waiting for accept",
  "en-route": "Engineer walking to the asset",
  "on-site": "Engineer on site",
  repairing: "Repair in progress",
  resolved: "Resolved",
  cancelled: "Cancelled",
};
export const requestStatusText = (r: MaintenanceRequest) => STATUS_TEXT[r.status];

export function etaText(min: number) {
  return min < 1 ? `${Math.max(1, Math.round(min * 60))} s` : `${fmt(min, 1)} min`;
}

export function PriorityChip({ p }: { p: MaintenanceRequest["priority"] }) {
  return <span className={`prio prio-${p.toLowerCase()}`}>{p}</span>;
}

// The manager picks who goes. Nearest free engineer is preselected; nothing is sent until Dispatch is pressed.
export function DispatchControl({ r }: { r: MaintenanceRequest }) {
  const engineers = useStore((s) => s.plant.engineers);
  const act = useStore((s) => s.act);
  const canControl = useCanControl();
  const [chosen, setChosen] = useState<string | null>(null);
  if (!canControl) return null;
  const free = engineers
    .filter((e) => e.status === "available")
    .map((e) => ({ e, m: pathLength(routeFrom(e.pos, r.asset)) }))
    .sort((a, b) => a.m - b.m);
  if (!free.length) return <p className="note">Every engineer is busy. Dispatch once someone is free.</p>;
  const pick = free.find((f) => f.e.id === chosen)?.e.id ?? free[0].e.id;
  return (
    <form className="dispatch" onSubmit={(ev) => { ev.preventDefault(); act({ type: "dispatch", requestId: r.id, engineerId: pick }); }}>
      <label className="sr-only" htmlFor={`dispatch-${r.id}`}>Engineer for {r.id}</label>
      <select id={`dispatch-${r.id}`} value={pick} onChange={(ev) => setChosen(ev.target.value)}>
        {free.map(({ e, m }) => (
          <option key={e.id} value={e.id}>{e.name}{e.kind === "phone" ? " (phone)" : ""}, {m < 5 ? "already there" : `${fmt(m)} m away`}</option>
        ))}
      </select>
      <button type="submit" className="btn btn-primary">Dispatch</button>
    </form>
  );
}

function MaintenanceBox({ asset }: { asset: string }) {
  const req = useStore((s) => s.plant.requests.find((r) => r.asset === asset && r.status !== "resolved" && r.status !== "cancelled"));
  const rec = useStore((s) => s.plant.recommendations.find((r) => r.asset === asset && r.status === "pending"));
  const engineer = useStore((s) => (req ? s.plant.engineers.find((e) => e.id === req.engineerId) : undefined));
  const act = useStore((s) => s.act);
  const canControl = useCanControl();
  const [reason, setReason] = useState("");
  return (
    <div className="maint-box">
      <h4 className="sub">Maintenance</h4>
      {req ? (
        <>
          <div className="maint-line">
            <PriorityChip p={req.priority} />
            <strong>{req.id}</strong>
            <span className="maint-origin">{req.origin === "model" ? "requested on model advice" : "requested manually"}</span>
          </div>
          <p className="maint-reason">{req.reason}</p>
          <dl className="kv">
            <div><dt>Status</dt><dd>{requestStatusText(req)}</dd></div>
            <div><dt>Engineer</dt><dd>{engineer?.name ?? "Not assigned"}</dd></div>
            {req.status !== "open" && <div><dt>Fixed in</dt><dd>{etaText(req.etaMin)}</dd></div>}
          </dl>
          {req.status === "open" && <DispatchControl r={req} />}
          {req.status === "repairing" && (
            <div className="ship-bar" aria-hidden><span style={{ transform: `scaleX(${1 - req.repairLeftS / REPAIR_S})` }} /></div>
          )}
          {canControl && <div className="actions"><button type="button" className="btn" onClick={() => act({ type: "cancel", requestId: req.id })}>Cancel request</button></div>}
        </>
      ) : rec ? (
        <RecommendationCard key={rec.id} rec={rec} compact />
      ) : !canControl ? (
        <p className="note">No open request for {assetLabel(asset)}.</p>
      ) : (
        <form
          className="maint-form"
          onSubmit={(e) => { e.preventDefault(); act({ type: "request", asset, reason }); setReason(""); }}
        >
          <label htmlFor={`reason-${asset}`}>No open request for {assetLabel(asset)}.</label>
          <input id={`reason-${asset}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What should the engineer check? (optional)" maxLength={200} />
          <button type="submit" className="btn btn-primary">Raise request</button>
        </form>
      )}
    </div>
  );
}

const GAS_LEVEL_TEXT = { good: "Good", reduced: "Reduced", poor: "Poor, possible leak" } as const;

function GasDetail() {
  const gas = useStore((s) => s.plant.gas);
  const history = gas.history.filter((v) => Number.isFinite(v));
  const warming = gas.connected && gas.samples <= GAS_WARMUP_SAMPLES;
  return (
    <div className="detail">
      <div className="detail-head">
        <h3>Gas metering</h3>
        {gas.connected && gas.level && <span className={`status status-plain ${gas.level === "poor" ? "status-tripped" : gas.level === "reduced" ? "status-watch" : ""}`}>{warming ? "Learning clean air" : GAS_LEVEL_TEXT[gas.level]}</span>}
      </div>
      <p className="note">Pipeline gas is measured here before it reaches the turbines. An air quality sensor next to the skid watches for leaks.</p>
      {gas.connected && gas.qualityPct !== null ? (
        <>
          <div className="sensor-head">
            <h4 className="sub">Air quality</h4>
            <SourceTag source="live" />
          </div>
          <p className={`gas-reading gas-${gas.level}`}>{gas.qualityPct}<span>% of clean air</span></p>
          <div className="trend-row">
            <span>Last 3 min (leak alert below {GAS_ALERT_PCT}%)</span>
            <Spark values={history} lo={0} hi={100} warn={GAS_ALERT_PCT} />
          </div>
          <dl className="kv">
            <div><dt>Sensor reading</dt><dd>{fmt(gas.raw ?? 0)}</dd></div>
            <div><dt>Clean-air level</dt><dd>{fmt(gas.baseline ?? 0)}</dd></div>
          </dl>
          <p className="note">The first seconds after the sensor connects set the clean-air level. Gas or fumes push the reading above it, and below {GAS_ALERT_PCT}% the manager gets a maintenance recommendation to check for a leak.</p>
        </>
      ) : (
        <p className="note">No air quality sensor connected. It reports through the sensor board.</p>
      )}
    </div>
  );
}

function AssetBody({ asset: selected }: { asset: string }) {
  const plant = useStore((s) => s.plant);
  const tb = plant.turbines.find((x) => x.id === selected);
  if (tb) return <TurbineDetail tb={tb} />;
  if (selected === "battery") {
    const b = plant.battery;
    return (
      <div className="detail">
        <div className="detail-head"><h3>Battery yard</h3></div>
        <dl className="kv">
          <div><dt>Charge</dt><dd>{fmt(b.socPct, 1)} %</dd></div>
          <div><dt>Power</dt><dd>{fmt(b.powerMw)} MW {b.powerMw > 5 ? "out" : b.powerMw < -5 ? "in" : ""}</dd></div>
          <div><dt>Capacity</dt><dd>{fmt(b.capacityMwh)} MWh</dd></div>
          <div><dt>Max power</dt><dd>{fmt(b.maxPowerMw)} MW</dd></div>
        </dl>
      </div>
    );
  }
  if (selected === "switchyard") {
    return (
      <div className="detail">
        <div className="detail-head"><h3>Switchyard</h3></div>
        <dl className="kv">
          <div><dt>Power to data center</dt><dd>{fmt(plant.demandMw)} MW</dd></div>
          <div><dt>From turbines</dt><dd>{fmt(plant.outputMw)} MW</dd></div>
          <div className={plant.gridMw > 1 ? "is-watch" : ""}><dt>Grid tie</dt><dd>{plant.gridMw > 1 ? `importing ${fmt(plant.gridMw)} MW` : "standby"}</dd></div>
        </dl>
        <p className="note">Steps turbine power up to transmission voltage and routes it to the data center. The grid tie only carries power when the plant falls short.</p>
      </div>
    );
  }
  if (selected === "gas") return <GasDetail />;
  if (selected === "acc") {
    return (
      <div className="detail">
        <div className="detail-head"><h3>Air-cooled condenser</h3></div>
        <p className="note">Turns the steam turbine's exhaust back into water using air instead of a cooling tower, which saves water in West Texas. The dataset has no condenser readings, so this asset has no live values yet.</p>
      </div>
    );
  }
  if (selected === "datacenter") {
    return (
      <div className="detail">
        <div className="detail-head"><h3>AI data center</h3></div>
        <dl className="kv">
          <div><dt>Load</dt><dd>{fmt(plant.demandMw)} MW</dd></div>
          <div><dt>Served by turbines</dt><dd>{fmt(Math.min(plant.outputMw, plant.demandMw))} MW</dd></div>
          <div><dt>Served by battery</dt><dd>{fmt(Math.max(0, plant.battery.powerMw))} MW</dd></div>
          <div><dt>Served by grid</dt><dd>{fmt(plant.gridMw)} MW</dd></div>
        </dl>
        <p className="note">Training jobs pull power in bursts of about 170 MW every 90 seconds.</p>
      </div>
    );
  }
  return null;
}

export function AlarmList({ events, limit = 8, empty = "No alarms." }: { events: PlantEvent[]; limit?: number; empty?: string }) {
  const select = useStore((s) => s.select);
  if (!events.length) return <p className="empty">{empty}</p>;
  return (
    <ol className="alarms">
      {events.slice(0, limit).map((e) => (
        <li key={e.id} className={`alarm alarm-${e.severity}`}>
          <time>{clockOf(e.t)}</time>
          <button type="button" onClick={() => select(e.asset)}>{e.text}</button>
        </li>
      ))}
    </ol>
  );
}

export function TurbineStrip() {
  const turbines = useStore((s) => s.plant.turbines);
  const pending = new Set(usePendingRecs().map((r) => r.asset));
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  return (
    <div className="strip-wrap"><ul className="strip" aria-label="Turbine fleet">
      {turbines.map((tb) => (
        <li key={tb.id}>
          <button
            type="button"
            className={`unit unit-${tb.status} ${pending.has(tb.id) ? "has-rec" : ""} ${selected === tb.id ? "is-selected" : ""}`}
            aria-pressed={selected === tb.id}
            onClick={() => select(tb.id)}
          >
            <span className="unit-id">{tb.id}</span>
            <span className="unit-mw">{tb.status === "running" || tb.status === "watch" ? fmt(tb.outputMw) : "0"}<small> MW</small></span>
            <span className="unit-meta">{pending.has(tb.id) ? "Needs a decision" : tb.status === "running" || tb.status === "watch" ? `wear ${fmt(tb.features.toolWearMin)} min` : tb.status[0].toUpperCase() + tb.status.slice(1)}</span>
            <span className="unit-bar"><span style={{ transform: `scaleX(${tb.outputMw / tb.ratedMw})` }} /></span>
          </button>
        </li>
      ))}
    </ul></div>
  );
}

export function PredictionList() {
  const preds = useStore((s) => s.plant.predictions);
  const select = useStore((s) => s.select);
  const flagged = preds.filter((p) => p.risk >= 0.2 || (p.minutesToFailure !== null && p.minutesToFailure <= 5));
  return (
    <>
      {flagged.length === 0 ? (
        <p className="empty">No unit is heading toward a failure in the next few minutes.</p>
      ) : (
        <ul className="preds">
          {flagged.map((p) => (
            <li key={p.turbineId}>
              <button type="button" onClick={() => select(p.turbineId)}>
                <strong>{p.turbineId}</strong>
                <span>{p.mode ? `${FAILURE_NAME[p.mode]}${p.minutesToFailure !== null ? ` in ~${fmt(p.minutesToFailure, 1)} min` : ""}` : `${Math.round(p.probability * 100)}% failure probability`}{p.by !== "Decision tree" && ` (${p.by})`}</span>
                <meter min={0} max={1} low={0.3} high={0.6} optimum={0} value={p.risk} aria-label={`Risk ${Math.round(p.risk * 100)}%`} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="note">{modelNote(preds.some((p) => p.ml))}</p>
    </>
  );
}

export function SensorPanel() {
  const board = useStore((s) => s.plant.board);
  return (
    <>
      {board.features ? <FeatureList f={board.features} /> : <p className="empty">No readings received yet.</p>}
      <p className="note">
        {board.source !== "live"
          ? `Not connected. ${LIVE_SENSOR_UNIT} is replaying the dataset like the other units until the board posts readings.`
          : (() => {
            const missing = FEATURE_ROWS.filter((r) => board.features?.[r.key] === undefined).map((r) => r.key);
            return missing.length
              ? `These drive ${LIVE_SENSOR_UNIT} live. The board doesn't send ${featureNames(missing)}, so those come from the dataset. Readings that break the failure rules trip it.`
              : `All six readings drive ${LIVE_SENSOR_UNIT} live. Readings that break the dataset's failure rules trip it.`;
          })()}
      </p>
    </>
  );
}
