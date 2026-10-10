import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { GEOFENCE_KM, SITE_LON_LAT, splitRoute } from '@engine/sim/engine';
import type { Shipment } from '@engine/types';
import { C } from '@/ui/theme';

// MapLibre in a WebView: no Google Maps API key, and it runs the same in Expo Go and a release APK.
const html = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet">
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>
html,body,#m{margin:0;height:100%;background:#e9e9e4}
.pin{font:600 12px system-ui,sans-serif;padding:5px 8px;border-radius:3px;background:#e4e6e1;border:1px solid #1e2321;color:#1e2321;white-space:nowrap}
.site{background:#1e2321;color:#e4e6e1}
.sel{background:${C.flow};border-color:${C.flow};color:#fff}
.arr{opacity:.6}
</style></head><body><div id="m"></div><script>
const send=(o)=>window.ReactNativeWebView.postMessage(JSON.stringify(o));
const site=${JSON.stringify(SITE_LON_LAT)};
const m=new maplibregl.Map({container:'m',style:'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',center:[-103,31.45],zoom:6.6,attributionControl:{compact:true}});
const markers={};let ready=false,pending=null,fitted=false;
function circle(c,km){const p=[];const dl=km/110.574,dn=km/(111.32*Math.cos(c[1]*Math.PI/180));for(let i=0;i<=64;i++){const a=i/64*Math.PI*2;p.push([c[0]+dn*Math.cos(a),c[1]+dl*Math.sin(a)])}return p}
m.on('load',()=>{
 m.addSource('fence',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[circle(site,${GEOFENCE_KM})]}}});
 m.addLayer({id:'fence',type:'line',source:'fence',paint:{'line-color':'${C.flow}','line-width':1.5,'line-dasharray':[2,2]}});
 m.addSource('ahead',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
 m.addSource('driven',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
 m.addLayer({id:'ahead',type:'line',source:'ahead',layout:{'line-cap':'round'},paint:{'line-color':'#1e2321','line-width':['case',['get','sel'],3,1.5],'line-opacity':['case',['get','sel'],.7,.35],'line-dasharray':[1.5,1.5]}});
 m.addLayer({id:'driven',type:'line',source:'driven',layout:{'line-cap':'round'},paint:{'line-color':'${C.flow}','line-width':['case',['get','sel'],5,3],'line-opacity':['case',['get','sel'],1,.5]}});
 const s=document.createElement('div');s.className='pin site';s.textContent='Plant';
 s.onclick=()=>m.flyTo({center:site,zoom:12});
 new maplibregl.Marker({element:s}).setLngLat(site).addTo(m);
 ready=true;if(pending)window.update(pending);send({type:'ready'});
});
window.update=(d)=>{
 if(!ready){pending=d;return}
 const f=(lines,key)=>({type:'FeatureCollection',features:lines.map(x=>({type:'Feature',properties:{sel:x.sel},geometry:{type:'LineString',coordinates:x[key]}}))});
 m.getSource('driven').setData(f(d.items,'driven'));
 m.getSource('ahead').setData(f(d.items.filter(x=>!x.arrived),'ahead'));
 for(const x of d.items){
  let mk=markers[x.id];
  if(!mk){const el=document.createElement('div');el.className='pin';el.textContent=x.id;el.onclick=(e)=>{e.stopPropagation();send({type:'select',id:x.id})};mk=markers[x.id]=new maplibregl.Marker({element:el}).setLngLat(x.pos).addTo(m)}
  mk.setLngLat(x.pos);const el=mk.getElement();el.classList.toggle('sel',x.sel);el.classList.toggle('arr',x.arrived);
 }
 if(!fitted){fitted=true;const b=new maplibregl.LngLatBounds();d.items.forEach(x=>{x.driven.forEach(p=>b.extend(p));x.ahead.forEach(p=>b.extend(p))});m.fitBounds(b,{padding:40,duration:0})}
};
window.focusOn=(p)=>m.flyTo({center:p,zoom:Math.max(m.getZoom(),9.5),duration:1200});
window.showAll=()=>{const b=new maplibregl.LngLatBounds();Object.values(markers).forEach(k=>b.extend(k.getLngLat()));b.extend(site);m.fitBounds(b,{padding:50,duration:1000})};
</script></body></html>`;

export function ShipmentMap({ shipments, selectedId, onSelect, showAllKey }: {
  shipments: Shipment[];
  selectedId: string;
  onSelect: (id: string) => void;
  showAllKey: number;
}) {
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const payload = useMemo(() => JSON.stringify({
    items: shipments.map((sh) => {
      const [driven, ahead] = splitRoute(sh.route, sh.progress);
      return { id: sh.id, pos: [sh.lon, sh.lat], driven, ahead, arrived: sh.arrived, sel: sh.id === selectedId };
    }),
  }), [shipments, selectedId]);

  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.update(${payload});true;`);
  }, [payload, ready]);

  const focusTarget = shipments.find((s) => s.id === selectedId);
  const focusRef = useRef(selectedId);
  useEffect(() => {
    // Fly only when the pick changes, not on every position update.
    if (!ready || !focusTarget || focusRef.current === selectedId) return;
    focusRef.current = selectedId;
    web.current?.injectJavaScript(`window.focusOn(${JSON.stringify([focusTarget.lon, focusTarget.lat])});true;`);
  }, [selectedId, ready, focusTarget]);

  useEffect(() => {
    if (ready && showAllKey > 0) web.current?.injectJavaScript('window.showAll();true;');
  }, [showAllKey, ready]);

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = JSON.parse(e.nativeEvent.data) as { type: string; id?: string };
    if (msg.type === 'ready') setReady(true);
    if (msg.type === 'select' && msg.id) onSelect(msg.id);
  };

  return (
    <View style={styles.box}>
      <WebView
        ref={web}
        source={{ html }}
        originWhitelist={['*']}
        onMessage={onMessage}
        javaScriptEnabled
        style={styles.web}
        accessibilityLabel="Map of inbound shipments"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 320, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: C.rule, backgroundColor: '#e9e9e4' },
  web: { flex: 1, backgroundColor: '#e9e9e4' },
});
