import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { LIVE_SENSOR_UNIT, REPAIR_S, WATCH_RISK } from "../sim/engine";
import { FAILURE_NAME, modelNote } from "../sim/model";
import type { Features, HistoryPoint, MaintenanceRequest, MlDiagnosis, PlantEvent, Source, Turbine } from "../types";
import { assetLabel } from "../sim/site";
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
      {ml.factors && (
        <ul className="ml-factors" aria-label="Inputs that moved the risk most">
          {ml.factors.map((f) => (
            <li key={f.feature}>
              <span>{FACTOR_LABEL[f.feature] ?? f.feature} <span className="muted">{typeof f.value === "number" ? `${fmt(f.value, Number.isInteger(f.value) ? 0 : 1)} ${f.feature.match(/\[(.+)\]/)?.[1] ?? ""}` : f.value}</span></span>
              <span className={f.contribution > 0 ? "up" : "down"}>{f.contribution > 0 ? "+" : "−"}{Math.abs(Math.round(f.contribution * 100))} pts</span>
            </li>
          ))}
        </ul>
      )}
      {urgent && <p className="ml-action">{ml.action}</p>}
    </section>
  );
}

export function TurbineDetail({ tb }: { tb: Turbine }) {
  const risk = useStore((s) => s.plant.riskHistory[tb.id] ?? []);
  const pred = useStore((s) => s.plant.predictions.find((p) => p.turbineId === tb.id));
  const trip = useStore((s) => s.trip);
  const reset = useStore((s) => s.reset);
  const canTrip = tb.status === "running" || tb.status === "watch";
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
        {tb.status === "tripped" && <button type="button" className="btn" onClick={() => reset(tb.id)}>Reset and restart</button>}
      </div>
    </div>
  );
}

export function AssetDetail() {
  const selected = useStore((s) => s.selected);
  const fallback = useStore((s) => s.plant.predictions[0]?.turbineId ?? "GT-01");
  const asset = selected ?? fallback;
  return (
    <>
      <AssetBody />
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

function MaintenanceBox({ asset }: { asset: string }) {
  const req = useStore((s) => s.plant.requests.find((r) => r.asset === asset && r.status !== "resolved" && r.status !== "cancelled"));
  const engineer = useStore((s) => (req ? s.plant.engineers.find((e) => e.id === req.engineerId) : undefined));
  const act = useStore((s) => s.act);
  const [reason, setReason] = useState("");
  return (
    <div className="maint-box">
      <h4 className="sub">Maintenance</h4>
      {req ? (
        <>
          <div className="maint-line">
            <PriorityChip p={req.priority} />
            <strong>{req.id}</strong>
            <span className="maint-origin">{req.origin === "auto" ? "raised by sensors" : "requested manually"}</span>
          </div>
          <p className="maint-reason">{req.reason}</p>
          <dl className="kv">
            <div><dt>Status</dt><dd>{requestStatusText(req)}</dd></div>
            <div><dt>Engineer</dt><dd>{engineer?.name ?? "Not assigned"}</dd></div>
            {req.status !== "open" && <div><dt>Fixed in</dt><dd>{etaText(req.etaMin)}</dd></div>}
          </dl>
          {req.status === "repairing" && (
            <div className="ship-bar" aria-hidden><span style={{ transform: `scaleX(${1 - req.repairLeftS / REPAIR_S})` }} /></div>
          )}
          <div className="actions"><button type="button" className="btn" onClick={() => act({ type: "cancel", requestId: req.id })}>Cancel request</button></div>
        </>
      ) : (
        <form
          className="maint-form"
          onSubmit={(e) => { e.preventDefault(); act({ type: "request", asset, reason }); setReason(""); }}
        >
          <label htmlFor={`reason-${asset}`}>No open request for {assetLabel(asset)}.</label>
          <input id={`reason-${asset}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What should the engineer check? (optional)" maxLength={200} />
          <button type="submit" className="btn btn-primary">Request engineer</button>
        </form>
      )}
    </div>
  );
}

function AssetBody() {
  const selected = useStore((s) => s.selected);
  const plant = useStore((s) => s.plant);
  if (!selected) {
    const riskiest = plant.predictions[0]?.turbineId;
    const tb = plant.turbines.find((x) => x.id === riskiest) ?? plant.turbines[0];
    return (
      <>
        <p className="hint">Showing the unit most at risk. Click any unit to switch.</p>
        <TurbineDetail tb={tb} />
      </>
    );
  }
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
  if (selected === "gas") {
    return (
      <div className="detail">
        <div className="detail-head"><h3>Gas metering</h3></div>
        <p className="note">Pipeline gas is measured here before it reaches the turbines. The dataset has no gas readings, so this asset has no live values yet.</p>
      </div>
    );
  }
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
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  return (
    <div className="strip-wrap"><ul className="strip" aria-label="Turbine fleet">
      {turbines.map((tb) => (
        <li key={tb.id}>
          <button
            type="button"
            className={`unit unit-${tb.status} ${selected === tb.id ? "is-selected" : ""}`}
            aria-pressed={selected === tb.id}
            onClick={() => select(tb.id)}
          >
            <span className="unit-id">{tb.id}</span>
            <span className="unit-mw">{tb.status === "running" || tb.status === "watch" ? fmt(tb.outputMw) : "0"}<small> MW</small></span>
            <span className="unit-meta">{tb.status === "running" || tb.status === "watch" ? `wear ${fmt(tb.features.toolWearMin)} min` : tb.status[0].toUpperCase() + tb.status.slice(1)}</span>
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
