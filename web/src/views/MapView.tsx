import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useStore } from "../store";
import { SITE_LON_LAT } from "../sim/engine";
import { Panel, ShipmentDetail } from "../ui/parts";

const STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

function markerEl(cls: string, label: string) {
  const el = document.createElement("div");
  el.className = `pin ${cls}`;
  el.setAttribute("aria-label", label);
  el.textContent = label;
  return el;
}

export function ShipmentMap() {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const truck = useRef<maplibregl.Marker | null>(null);
  const sh = useStore((s) => s.plant.shipments[0]);

  useEffect(() => {
    if (!box.current || !sh) return;
    const m = new maplibregl.Map({ container: box.current, style: STYLE, center: [-102.8, 31.65], zoom: 7.2, attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      m.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: sh.route } } });
      m.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#2f5d8a", "line-width": 4, "line-opacity": 0.85 }, layout: { "line-cap": "round", "line-join": "round" } });
      const bounds = new maplibregl.LngLatBounds();
      sh.route.forEach((p) => bounds.extend(p));
      m.fitBounds(bounds, { padding: 60, duration: 0 });
    });
    new maplibregl.Marker({ element: markerEl("pin-site", "Plant") }).setLngLat(SITE_LON_LAT).addTo(m);
    new maplibregl.Marker({ element: markerEl("pin-origin", "Midland yard") }).setLngLat(sh.route[0]).addTo(m);
    truck.current = new maplibregl.Marker({ element: markerEl("pin-truck", sh.id) }).setLngLat([sh.lon, sh.lat]).addTo(m);
    return () => { m.remove(); map.current = null; };
    // Map is built once; position updates go through the marker below.
  }, []);

  useEffect(() => {
    if (sh) truck.current?.setLngLat([sh.lon, sh.lat]);
  }, [sh?.lon, sh?.lat, sh]);

  return <div ref={box} className="map" role="region" aria-label="Shipment map" />;
}

export function MapView() {
  const sh = useStore((s) => s.plant.shipments[0]);
  return (
    <div className="map-view">
      <ShipmentMap />
      <aside className="map-side">
        <Panel title="Inbound shipment">
          {sh ? <ShipmentDetail id={sh.id} /> : <p className="empty">No shipments on the road.</p>}
          <p className="note">Simulated route replays at 40x. Point a phone's GPS at this trailer to track it live.</p>
        </Panel>
      </aside>
    </div>
  );
}
