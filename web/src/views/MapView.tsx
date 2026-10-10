import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { PHONE_GPS_SCALE, useStore } from "../store";
import { GEOFENCE_KM, SHIPMENT_REPLAY_SPEED, SITE_LON_LAT, splitRoute } from "../sim/engine";
import { AlarmList, Panel, SourceTag, clockOf, fmt } from "../ui/parts";
import type { Shipment } from "../types";

maplibregl.setWorkerUrl(workerUrl);

const STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: { type: "LineString"; coordinates: [number, number][] } };

function circle(center: [number, number], km: number, steps = 64): [number, number][] {
  const pts: [number, number][] = [];
  const dLat = km / 110.574;
  const dLon = km / (111.32 * Math.cos((center[1] * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([center[0] + dLon * Math.cos(a), center[1] + dLat * Math.sin(a)]);
  }
  return pts;
}

function fitAll(m: maplibregl.Map, duration = 1000) {
  const bounds = new maplibregl.LngLatBounds();
  useStore.getState().plant.shipments.forEach((sh) => sh.route.forEach((p) => bounds.extend(p)));
  m.fitBounds(bounds, { padding: { top: 60, bottom: 50, left: 40, right: 60 }, duration });
}

function routeFeatures(shipments: Shipment[], selectedId: string): { driven: Feature[]; ahead: Feature[] } {
  const driven: Feature[] = [], ahead: Feature[] = [];
  for (const sh of shipments) {
    const [d, a] = splitRoute(sh.route, sh.progress);
    const props = { selected: sh.id === selectedId };
    driven.push({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: d } });
    if (!sh.arrived) ahead.push({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: a } });
  }
  return { driven, ahead };
}

export function statusOf(sh: Shipment) {
  if (sh.arrived) return "Arrived";
  if (sh.remainingKm <= GEOFENCE_KM) return "At the gate";
  return "In transit";
}

function useSelectedShipment() {
  const shipments = useStore((s) => s.plant.shipments);
  const selected = useStore((s) => s.selected);
  return shipments.find((x) => x.id === selected) ?? shipments.find((x) => !x.arrived) ?? shipments[0];
}

function ShipmentMap() {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const shipments = useStore((s) => s.plant.shipments);
  const select = useStore((s) => s.select);
  const current = useSelectedShipment();

  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current, style: STYLE, center: [-103.0, 31.45], zoom: 7.4,
      attributionControl: { compact: true }, cooperativeGestures: window.matchMedia("(max-width: 720px)").matches,
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      m.addSource("geofence", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circle(SITE_LON_LAT, GEOFENCE_KM)] } } });
      m.addLayer({ id: "geofence-fill", type: "fill", source: "geofence", paint: { "fill-color": "#2f5d8a", "fill-opacity": 0.08 } });
      m.addLayer({ id: "geofence-line", type: "line", source: "geofence", paint: { "line-color": "#2f5d8a", "line-width": 1.5, "line-dasharray": [2, 2] } });
      m.addSource("ahead", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("driven", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "ahead", type: "line", source: "ahead", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#1e2321", "line-width": ["case", ["get", "selected"], 3, 1.5], "line-opacity": ["case", ["get", "selected"], 0.7, 0.35], "line-dasharray": [1.5, 1.5] },
      });
      m.addLayer({
        id: "driven", type: "line", source: "driven", layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2f5d8a", "line-width": ["case", ["get", "selected"], 5, 3], "line-opacity": ["case", ["get", "selected"], 1, 0.5] },
      });
      ready.current = true;
      fitAll(m, 0);
    });
    const site = document.createElement("button");
    site.type = "button";
    site.className = "pin pin-site";
    site.textContent = "Plant";
    site.addEventListener("click", (e) => { e.stopPropagation(); m.flyTo({ center: SITE_LON_LAT, zoom: 12, duration: 1200 }); });
    new maplibregl.Marker({ element: site }).setLngLat(SITE_LON_LAT).addTo(m);
    const markerMap = markers.current;
    return () => { m.remove(); map.current = null; ready.current = false; markerMap.clear(); };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const sh of shipments) {
      let mk = markers.current.get(sh.id);
      if (!mk) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "pin pin-truck";
        el.textContent = sh.id;
        el.addEventListener("click", (e) => { e.stopPropagation(); select(sh.id); });
        mk = new maplibregl.Marker({ element: el }).setLngLat([sh.lon, sh.lat]).addTo(m);
        markers.current.set(sh.id, mk);
      }
      mk.setLngLat([sh.lon, sh.lat]);
      const el = mk.getElement();
      el.classList.toggle("is-selected", sh.id === current?.id);
      el.classList.toggle("is-live", sh.source === "live");
      el.classList.toggle("is-arrived", sh.arrived);
      el.setAttribute("aria-pressed", String(sh.id === current?.id));
    }
    if (ready.current && current) {
      const { driven, ahead } = routeFeatures(shipments, current.id);
      (m.getSource("driven") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: driven });
      (m.getSource("ahead") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: ahead });
    }
  }, [shipments, current, select]);

  // Picking a truck from a label or the list flies the map to it; live position updates don't move the camera.
  const selectedId = useStore((s) => s.selected);
  useEffect(() => {
    const m = map.current;
    const sh = useStore.getState().plant.shipments.find((x) => x.id === selectedId);
    if (!m || !sh) return;
    m.flyTo({ center: [sh.lon, sh.lat], zoom: Math.max(m.getZoom(), 9.5), duration: 1200, essential: true });
  }, [selectedId]);

  return (
    <div className="map-wrap">
      <div ref={box} className="map" role="region" aria-label="Map of inbound shipments" />
      <button type="button" className="btn map-reset" onClick={() => map.current && fitAll(map.current)}>Show all routes</button>
      <div className="map-legend" aria-hidden>
        <span className="lg-driven">Driven</span>
        <span className="lg-ahead">Still to drive</span>
        <span className="lg-fence">{GEOFENCE_KM} km site geofence</span>
      </div>
    </div>
  );
}

function ShipmentList() {
  const shipments = useStore((s) => s.plant.shipments);
  const select = useStore((s) => s.select);
  const current = useSelectedShipment();
  return (
    <ul className="ship-list" aria-label="Inbound shipments">
      {shipments.map((sh) => (
        <li key={sh.id}>
          <button type="button" className={`ship ${sh.id === current?.id ? "is-selected" : ""}`} aria-pressed={sh.id === current?.id} onClick={() => select(sh.id)}>
            <span className="ship-top">
              <strong>{sh.id}</strong>
              <span className="ship-eta">{sh.arrived ? "Arrived" : `${fmt(Math.max(1, sh.etaMin))} min`}</span>
            </span>
            <span className="ship-cargo">{sh.cargo}</span>
            <span className="ship-bar" aria-hidden><span style={{ transform: `scaleX(${sh.progress})` }} /></span>
            {sh.source === "live" && <SourceTag source="live" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Stops({ sh }: { sh: Shipment }) {
  return (
    <div className="stops" role="img" aria-label={`${Math.round(sh.progress * 100)}% of the way from ${sh.origin} to the plant`}>
      <div className="stops-track"><span style={{ transform: `scaleX(${sh.progress})` }} /></div>
      {sh.stops.map((st, i) => {
        const last = i === sh.stops.length - 1;
        // Drop a stop's name when it would collide with the destination label.
        const crowded = !last && 1 - st.at < 0.16;
        return (
          <span
            key={st.name}
            className={`stop ${st.at <= sh.progress ? "is-passed" : ""} ${i === 0 ? "is-first" : ""} ${last ? "is-last" : ""}`}
            style={{ left: `${st.at * 100}%` }}
          >
            <i />
            {!crowded && <em>{st.name}</em>}
          </span>
        );
      })}
    </div>
  );
}

function ArrivalVsFailure({ sh }: { sh: Shipment }) {
  const pred = useStore((s) => s.plant.predictions.find((p) => p.turbineId === sh.forAsset));
  const tb = useStore((s) => s.plant.turbines.find((x) => x.id === sh.forAsset));
  if (!tb) return null;
  if (tb.status === "tripped") {
    return <p className="verdict verdict-trip">{tb.id} has already tripped. These parts are needed to bring it back.</p>;
  }
  if (!pred || pred.minutesToLimit === null) {
    return <p className="verdict">{tb.id} is not trending toward a limit. No rush on this delivery.</p>;
  }
  if (sh.arrived) return <p className="verdict">Parts are on site. {tb.id} reaches its trip limit in about {fmt(pred.minutesToLimit, 1)} min.</p>;
  const slack = pred.minutesToLimit - sh.etaMin;
  return slack >= 0 ? (
    <p className="verdict">Arrives about {fmt(slack, 1)} min before {tb.id} is forecast to reach its trip limit.</p>
  ) : (
    <p className="verdict verdict-watch">
      {tb.id} is forecast to reach its trip limit {fmt(-slack, 1)} min before these parts arrive. Reduce {tb.id} load to buy time.
    </p>
  );
}

function PhoneTracker({ sh }: { sh: Shipment }) {
  const gps = useStore((s) => s.phoneGps);
  const start = useStore((s) => s.startPhoneGps);
  const stop = useStore((s) => s.stopPhoneGps);
  const mine = gps?.shipmentId === sh.id ? gps : null;
  if (sh.arrived) return null;
  return (
    <div className="tracker">
      {!mine ? (
        <>
          <button type="button" className="btn" onClick={() => start(sh.id)}>Drive {sh.id} with this phone</button>
          <p className="note">Uses this device's GPS. Each metre you walk moves the trailer {PHONE_GPS_SCALE} m along its route.</p>
        </>
      ) : (
        <>
          <p className="tracker-status">
            {mine.status === "waiting" && "Waiting for a GPS fix. Step outside or near a window if it takes long."}
            {mine.status === "tracking" && `Tracking. You have walked ${fmt(mine.walkedM)} m${mine.accuracyM ? `, accurate to ${fmt(mine.accuracyM)} m` : ""}.`}
            {mine.status === "denied" && "Location permission was blocked. Allow location for this site in the browser settings, then try again."}
            {mine.status === "unavailable" && "This browser can't share location here. Open the site over https on a phone."}
          </p>
          <button type="button" className="btn" onClick={stop}>Stop tracking</button>
        </>
      )}
    </div>
  );
}

function ShipmentDetail() {
  const sh = useSelectedShipment();
  const t = useStore((s) => s.plant.t);
  const events = useStore((s) => s.plant.events);
  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  if (!sh) return <p className="empty">No shipments on the road.</p>;
  const isTurbine = sh.forAsset.startsWith("GT-");
  return (
    <div className="ship-detail">
      <div className="detail-head">
        <h3>{sh.id}</h3>
        <span className={`status status-plain status-${sh.arrived ? "arrived" : "moving"}`}>{statusOf(sh)}</span>
        <SourceTag source={sh.source} />
      </div>
      <p className="ship-what">
        {sh.cargo}
        {isTurbine && (
          <> for <button type="button" className="link" onClick={() => { select(sh.forAsset); setView("twin"); }}>{sh.forAsset}</button></>
        )}
      </p>
      <div className="eta">
        <span className="eta-big">{sh.arrived ? "On site" : `${fmt(Math.max(1, sh.etaMin))} min`}</span>
        {!sh.arrived && <span className="eta-at">arrives {clockOf(t + sh.etaMin * 60)}</span>}
      </div>
      <Stops sh={sh} />
      {isTurbine && <ArrivalVsFailure sh={sh} />}
      <dl className="kv">
        <div><dt>Distance left</dt><dd>{sh.arrived ? "0 km" : `${fmt(sh.remainingKm, 1)} km`}</dd></div>
        <div><dt>Speed</dt><dd>{fmt(sh.speedKmh)} km/h</dd></div>
        <div><dt>Carrier</dt><dd>{sh.carrier}</dd></div>
        <div><dt>From</dt><dd>{sh.origin}</dd></div>
        <div><dt>Position</dt><dd>{fmt(sh.lat, 4)}, {fmt(sh.lon, 4)}</dd></div>
      </dl>
      <PhoneTracker sh={sh} />
      <h4 className="sub">Trip log</h4>
      <AlarmList events={events.filter((e) => e.asset === sh.id)} limit={5} empty="Nothing logged yet. Entering the geofence and arriving show up here." />
    </div>
  );
}

export function MapView() {
  return (
    <div className="map-view">
      <ShipmentMap />
      <aside className="map-side">
        <Panel title="Inbound to the plant"><ShipmentList /></Panel>
        <Panel title="Shipment"><ShipmentDetail /></Panel>
        <p className="note replay">Simulated trucks replay at {SHIPMENT_REPLAY_SPEED}x speed. ETAs use the same clock as the turbine forecast.</p>
      </aside>
    </div>
  );
}
