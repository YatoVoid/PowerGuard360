import { useStore } from "../store";
import { TRIP_TEMP_C, WATCH_TEMP_C } from "../sim/engine";
import type { HistoryPoint, PlantEvent, Source, Turbine } from "../types";

export const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function clockOf(t: number) {
  const base = new Date();
  base.setHours(14, 0, 0, 0);
  return new Date(base.getTime() + t * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function SourceTag({ source }: { source: Source }) {
  return <span className={`src src-${source}`}>{source === "live" ? "Live sensor" : "Simulated"}</span>;
}

export function Panel({ title, aside, children, className = "" }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2>{title}</h2>
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

export function BalanceChart({ history, height = 180 }: { history: HistoryPoint[]; height?: number }) {
  const w = 600, h = height, pad = { l: 44, r: 8, t: 8, b: 20 };
  const max = 2700, min = 0;
  const n = Math.max(history.length, 2);
  const x = (i: number) => pad.l + (i / (n - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  const ticks = [0, 900, 1800, 2700];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Power balance, last five minutes">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 6} y={y(v) + 4} className="axis" textAnchor="end">{fmt(v)}</text>
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
      <figcaption className="legend">
        {SERIES.map((s) => <span key={s.key} className={`key ${s.cls}`}>{s.label}</span>)}
        <span className="unit">MW</span>
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

export function TurbineDetail({ tb }: { tb: Turbine }) {
  const temps = useStore((s) => s.plant.tempHistory[tb.id] ?? []);
  const pred = useStore((s) => s.plant.predictions.find((p) => p.turbineId === tb.id));
  const trip = useStore((s) => s.trip);
  const reset = useStore((s) => s.reset);
  const canTrip = tb.status === "running" || tb.status === "watch";
  return (
    <div className="detail">
      <div className="detail-head">
        <h3>{tb.id}</h3>
        <span className={`status status-${tb.status}`}>{tb.status}</span>
      </div>
      {tb.tripCause && <p className="cause">{tb.tripCause}</p>}
      <dl className="kv">
        <div><dt>Output</dt><dd>{fmt(tb.outputMw)} / {fmt(tb.capacityMw)} MW</dd></div>
        <div className={tb.exhaustTempC >= WATCH_TEMP_C ? "is-watch" : ""}><dt>Exhaust temp</dt><dd>{fmt(tb.exhaustTempC)} °C</dd></div>
        <div><dt>Vibration</dt><dd>{fmt(tb.vibrationMmS, 1)} mm/s</dd></div>
        <div><dt>Speed</dt><dd>{fmt(tb.rpm)} rpm</dd></div>
        <div><dt>Fuel flow</dt><dd>{fmt(tb.fuelFlowKgS, 1)} kg/s</dd></div>
        <div><dt>Efficiency</dt><dd>{fmt(tb.efficiencyPct, 1)} %</dd></div>
        <div><dt>Run hours</dt><dd>{fmt(tb.runHours)}</dd></div>
      </dl>
      <div className="trend-row">
        <span>Exhaust temp, last 3 min</span>
        <Spark values={temps} lo={540} hi={TRIP_TEMP_C + 5} warn={WATCH_TEMP_C} />
      </div>
      {pred && pred.minutesToLimit !== null && (
        <p className="forecast">Reaches the {TRIP_TEMP_C} °C trip limit in about {fmt(pred.minutesToLimit, 1)} min at the current trend.</p>
      )}
      <div className="actions">
        {canTrip && <button type="button" className="btn btn-danger" onClick={() => trip(tb.id)}>Trip {tb.id}</button>}
        {tb.status === "tripped" && <button type="button" className="btn" onClick={() => reset(tb.id)}>Reset and restart</button>}
      </div>
    </div>
  );
}

export function AssetDetail() {
  const selected = useStore((s) => s.selected);
  const plant = useStore((s) => s.plant);
  if (!selected) return <p className="empty">Select a turbine, the battery, the data center or the truck to see its readings.</p>;
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
  const sh = plant.shipments.find((x) => x.id === selected);
  if (sh) return <ShipmentDetail id={sh.id} />;
  return null;
}

export function ShipmentDetail({ id }: { id: string }) {
  const sh = useStore((s) => s.plant.shipments.find((x) => x.id === id));
  if (!sh) return null;
  return (
    <div className="detail">
      <div className="detail-head">
        <h3>{sh.id}</h3>
        <SourceTag source={sh.source} />
      </div>
      <p className="cause">{sh.cargo}</p>
      <dl className="kv">
        <div><dt>Carrier</dt><dd>{sh.carrier}</dd></div>
        <div><dt>Distance left</dt><dd>{sh.arrived ? "On site" : `${fmt(sh.remainingKm, 1)} km`}</dd></div>
        <div><dt>ETA</dt><dd>{sh.arrived ? "Arrived" : `${fmt(sh.etaMin)} min`}</dd></div>
        <div><dt>Position</dt><dd>{fmt(sh.lat, 4)}, {fmt(sh.lon, 4)}</dd></div>
      </dl>
    </div>
  );
}

export function AlarmList({ events, limit = 8 }: { events: PlantEvent[]; limit?: number }) {
  const select = useStore((s) => s.select);
  if (!events.length) return <p className="empty">No alarms.</p>;
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
    <ul className="strip" aria-label="Turbine fleet">
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
            <span className="unit-meta">{tb.status === "running" ? `${fmt(tb.exhaustTempC)} °C` : tb.status}</span>
            <span className="unit-bar"><span style={{ transform: `scaleX(${tb.outputMw / tb.ratedMw})` }} /></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function PredictionList() {
  const preds = useStore((s) => s.plant.predictions);
  const select = useStore((s) => s.select);
  const flagged = preds.filter((p) => p.minutesToLimit !== null || p.risk > 0.2);
  return (
    <>
      {flagged.length === 0 ? (
        <p className="empty">No turbine is trending toward a limit.</p>
      ) : (
        <ul className="preds">
          {flagged.map((p) => (
            <li key={p.turbineId}>
              <button type="button" onClick={() => select(p.turbineId)}>
                <strong>{p.turbineId}</strong>
                <span>Overheat {p.minutesToLimit !== null ? `in ~${fmt(p.minutesToLimit, 1)} min` : "risk rising"}</span>
                <meter min={0} max={1} low={0.3} high={0.6} optimum={0} value={p.risk} aria-label={`Risk ${Math.round(p.risk * 100)}%`} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="note">Trend extrapolation on exhaust temperature. Replaced by the trained model once real turbine data is in.</p>
    </>
  );
}

export function SensorPanel() {
  const a = useStore((s) => s.plant.ambient);
  return (
    <>
      <dl className="kv">
        <div><dt>Barometric pressure</dt><dd>{fmt(a.pressureHpa, 1)} hPa</dd></div>
        <div><dt>Ambient temp</dt><dd>{fmt(a.temperatureC, 1)} °C</dd></div>
        <div><dt>Air quality (raw)</dt><dd>{fmt(a.airQualityRaw)}</dd></div>
        <div><dt>GT-01 flame detector (light)</dt><dd>{fmt(a.lightRaw)}</dd></div>
      </dl>
      <p className="note">
        {a.source === "live"
          ? "Readings from the site sensor board. Pressure and temperature set turbine capacity."
          : "No sensor board connected. Showing simulated readings."}
      </p>
    </>
  );
}
