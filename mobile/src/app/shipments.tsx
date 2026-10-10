import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GEOFENCE_KM, SHIPMENT_REPLAY_SPEED } from '@engine/sim/engine';
import type { Delivery, Shipment } from '@engine/types';
import { PHONE_GPS_SCALE, useStore } from '@/state/store';
import { Alarms, Btn, DeliveryInfo, KV, Panel, SourceTag, TopBar, st, tap } from '@/ui/parts';
import { ShipmentMap } from '@/ui/ShipmentMap';
import { C, F, S, clockOf, fmt } from '@/ui/theme';

function cardStatus(sh: Shipment, d: Delivery | undefined) {
  if (!sh.arrived) return `${fmt(Math.max(1, sh.etaMin))} min`;
  if (!d) return 'Arrived';
  if (d.status === 'delivered') return 'Delivered';
  const where = d.toAsset.startsWith('GT-') ? d.toAsset : d.toAsset === 'battery' ? 'battery' : 'skid';
  return `At ${where} in ${d.etaMin < 1 ? `${Math.max(1, Math.round(d.etaMin * 60))} s` : `${fmt(d.etaMin, 1)} min`}`;
}

function statusOf(sh: Shipment) {
  if (sh.arrived) return 'Arrived';
  if (sh.remainingKm <= GEOFENCE_KM) return 'At the gate';
  return 'In transit';
}

function Stops({ sh }: { sh: Shipment }) {
  return (
    <View style={styles.stops} accessibilityLabel={`${Math.round(sh.progress * 100)} percent of the way from ${sh.origin} to the plant`}>
      <View style={styles.track}><View style={{ height: 3, width: `${sh.progress * 100}%`, backgroundColor: C.flow }} /></View>
      {sh.stops.map((stop, i) => {
        const last = i === sh.stops.length - 1;
        const crowded = !last && 1 - stop.at < 0.18;
        const passed = stop.at <= sh.progress;
        return (
          <View key={stop.name} style={[styles.stop, { left: `${stop.at * 100}%` }, i === 0 && { transform: [{ translateX: -7 }] }, last && { transform: [{ translateX: -60 }], alignItems: 'flex-end', width: 70 }]}>
            <View style={[styles.dot, passed && { backgroundColor: C.flow, borderColor: C.flow }]} />
            {!crowded && <Text style={[st.small, { fontSize: 12 }, last && { fontFamily: F.bold, color: C.ink }]}>{stop.name}</Text>}
          </View>
        );
      })}
    </View>
  );
}

function Verdict({ sh }: { sh: Shipment }) {
  const pred = useStore((s) => s.plant.predictions.find((p) => p.turbineId === sh.forAsset));
  const tb = useStore((s) => s.plant.turbines.find((x) => x.id === sh.forAsset));
  if (!tb) return null;
  let text = `${tb.id} is not trending toward a limit. No rush on this delivery.`;
  let tone: 'plain' | 'watch' | 'trip' = 'plain';
  if (tb.status === 'tripped') { text = `${tb.id} has already tripped. These parts are needed to bring it back.`; tone = 'trip'; }
  else if (pred && pred.minutesToLimit !== null) {
    if (sh.arrived) text = `Parts are on site. ${tb.id} reaches its trip limit in about ${fmt(pred.minutesToLimit, 1)} min.`;
    else {
      const slack = pred.minutesToLimit - sh.etaMin;
      if (slack >= 0) text = `Arrives about ${fmt(slack, 1)} min before ${tb.id} is forecast to reach its trip limit.`;
      else { text = `${tb.id} is forecast to reach its trip limit ${fmt(-slack, 1)} min before these parts arrive. Reduce ${tb.id} load to buy time.`; tone = 'watch'; }
    }
  }
  const bg = tone === 'watch' ? C.watchBg : tone === 'trip' ? C.tripBg : C.surface2;
  const border = tone === 'watch' ? C.watch : tone === 'trip' ? C.trip : C.rule;
  return <Text style={[styles.verdict, { backgroundColor: bg, borderColor: border }, tone === 'watch' && { color: C.watchInk, fontFamily: F.medium }]}>{text}</Text>;
}

function PhoneTracker({ sh }: { sh: Shipment }) {
  const gps = useStore((s) => s.phoneGps);
  const start = useStore((s) => s.startPhoneGps);
  const stop = useStore((s) => s.stopPhoneGps);
  const mine = gps?.shipmentId === sh.id ? gps : null;
  if (sh.arrived) return null;
  return (
    <View style={styles.tracker}>
      {!mine ? (
        <>
          <Btn label={`Drive ${sh.id} with this phone`} onPress={() => start(sh.id)} />
          <Text style={[st.small, { marginTop: 8 }]}>Uses this phone's GPS. Each metre you walk moves the trailer {PHONE_GPS_SCALE} m along its route.</Text>
        </>
      ) : (
        <>
          <Text style={[st.body, { marginBottom: 8 }]}>
            {mine.status === 'waiting' && 'Waiting for a GPS fix. Step outside or near a window if it takes long.'}
            {mine.status === 'tracking' && `Tracking. You have walked ${fmt(mine.walkedM)} m${mine.accuracyM ? `, accurate to ${fmt(mine.accuracyM)} m` : ''}.`}
            {mine.status === 'denied' && 'Location permission was blocked. Allow location for Power Guard 360 in Settings, then try again.'}
            {mine.status === 'unavailable' && "This phone's location service is off. Turn it on and try again."}
          </Text>
          <Btn label="Stop tracking" onPress={stop} />
        </>
      )}
    </View>
  );
}

export default function Shipments() {
  const shipments = useStore((s) => s.plant.shipments);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const t = useStore((s) => s.plant.t);
  const events = useStore((s) => s.plant.events);
  const deliveries = useStore((s) => s.plant.deliveries);
  const [showAll, setShowAll] = useState(0);
  const { height } = useWindowDimensions();
  const sh = shipments.find((x) => x.id === selected) ?? shipments.find((x) => !x.arrived) ?? shipments[0];
  const delivery = deliveries.find((d) => d.shipmentId === sh.id);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.surface }}>
      <TopBar title="Shipments" />
      {/* The map stays pinned so dragging it never fights with scrolling the page. */}
      <View style={{ height: Math.round(height * 0.36), padding: S.gutter, paddingBottom: S.gap, backgroundColor: C.panel }}>
        <ShipmentMap shipments={shipments} selectedId={sh.id} onSelect={(id) => { tap(); select(id); }} showAllKey={showAll} />
        <Pressable
          onPress={() => { tap(); setShowAll((n) => n + 1); }}
          android_ripple={{ color: C.surface2 }}
          style={styles.showAll}
          accessibilityRole="button"
        >
          <Text style={st.btnText}>Show all</Text>
        </Pressable>
      </View>
      <ScrollView style={{ backgroundColor: C.panel }} contentContainerStyle={{ paddingHorizontal: S.gutter, gap: S.gap, paddingBottom: 32 }}>

        <Panel title="Inbound to the plant">
          <View style={{ gap: 6 }}>
            {shipments.map((x) => {
              const isSel = x.id === sh.id;
              return (
                <Pressable
                  key={x.id}
                  onPress={() => { tap(); select(x.id); }}
                  android_ripple={{ color: C.surface }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSel }}
                  style={[styles.card, isSel && { borderColor: C.flow, borderWidth: 2, backgroundColor: C.surface }]}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={st.predId}>{x.id}</Text>
                    <Text style={styles.eta}>{cardStatus(x, deliveries.find((d) => d.shipmentId === x.id))}</Text>
                  </View>
                  <Text style={st.small}>{x.cargo}</Text>
                  <View style={styles.bar}><View style={{ height: 3, width: `${x.progress * 100}%`, backgroundColor: C.flow }} /></View>
                  {x.source === 'live' && <View style={{ alignSelf: 'flex-start', marginTop: 4 }}><SourceTag source="live" /></View>}
                </Pressable>
              );
            })}
          </View>
        </Panel>

        <Panel title="Shipment" aside={<SourceTag source={sh.source} />}>
          <View style={st.detailHead}>
            <Text style={st.detailId}>{sh.id}</Text>
            <View style={[st.status, { backgroundColor: sh.arrived ? C.ink : C.surface2 }]}>
              <Text style={[st.statusText, sh.arrived && { color: C.surface }]}>{statusOf(sh)}</Text>
            </View>
          </View>
          <Text style={[st.body, { marginBottom: 10 }]}>{sh.cargo}{sh.forAsset.startsWith('GT-') ? ` for ${sh.forAsset}` : ''}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <Text style={styles.etaBig}>{sh.arrived ? 'On site' : `${fmt(Math.max(1, sh.etaMin))} min`}</Text>
            {!sh.arrived && <Text style={st.small}>arrives {clockOf(t + sh.etaMin * 60)}</Text>}
          </View>
          <Stops sh={sh} />
          {sh.forAsset.startsWith('GT-') && <Verdict sh={sh} />}
          <KV label="Distance left" value={sh.arrived ? '0 km' : `${fmt(sh.remainingKm, 1)} km`} />
          <KV label="Speed" value={`${fmt(sh.speedKmh)} km/h`} />
          <KV label="Carrier" value={sh.carrier} />
          <KV label="From" value={sh.origin} />
          {delivery && <DeliveryInfo d={delivery} />}
          <PhoneTracker sh={sh} />
          <Text style={[st.panelTitle, { marginTop: 16, marginBottom: 6 }]}>Trip log</Text>
          <Alarms events={events.filter((e) => e.asset === sh.id)} limit={5} empty="Nothing logged yet. Entering the geofence and arriving show up here." />
        </Panel>
        <Text style={[st.small, { paddingHorizontal: 4 }]}>Simulated trucks replay at {SHIPMENT_REPLAY_SPEED}x speed. ETAs use the same clock as the turbine forecast.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  showAll: { position: 'absolute', top: S.gutter + 8, left: S.gutter + 8, minHeight: 44, justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.ink, borderRadius: S.radiusS, paddingHorizontal: 14, overflow: 'hidden' },
  card: { minHeight: 64, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.rule, borderRadius: S.radiusS, padding: 12, gap: 3, overflow: 'hidden' },
  eta: { fontFamily: F.num, fontSize: 16, color: C.ink },
  bar: { height: 3, backgroundColor: C.rule, marginTop: 4, overflow: 'hidden' },
  etaBig: { fontFamily: F.numBold, fontSize: 34, color: C.ink },
  stops: { height: 44, marginHorizontal: 10, marginBottom: 12 },
  track: { position: 'absolute', left: 0, right: 0, top: 6, height: 3, backgroundColor: C.rule },
  stop: { position: 'absolute', top: 0, alignItems: 'center', gap: 5, transform: [{ translateX: -30 }], width: 60 },
  dot: { width: 15, height: 15, borderRadius: 8, borderWidth: 2, borderColor: C.rule, backgroundColor: C.surface },
  verdict: { fontFamily: F.regular, fontSize: 14, color: C.ink, borderWidth: 1, borderRadius: S.radiusS, padding: 10, marginBottom: 10 },
  tracker: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.rule },
});
