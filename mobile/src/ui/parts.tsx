import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Line, Polyline, Text as SvgText } from 'react-native-svg';

import { LIVE_SENSOR_UNIT, WATCH_RISK } from '@engine/sim/engine';
import { FAILURE_NAME, MODEL_METRICS } from '@engine/sim/model';
import type { Features, HistoryPoint, PlantEvent, Source, Turbine } from '@engine/types';
import { useStore } from '@/state/store';
import { C, F, S, clockOf, fmt } from '@/ui/theme';

export function TopBar({ title }: { title: string }) {
  const t = useStore((s) => s.plant.t);
  const alarms = useStore((s) => s.plant.turbines.filter((x) => x.status === 'watch' || x.status === 'tripped').length);
  return (
    <View style={st.top}>
      <View style={{ flex: 1 }}>
        <Text style={st.brand}>Power Guard 360</Text>
        <Text style={st.screen}>{title}</Text>
      </View>
      {alarms > 0 && (
        <View style={st.alarmCount}>
          <Text style={st.alarmCountText}>{alarms} {alarms === 1 ? 'alarm' : 'alarms'}</Text>
        </View>
      )}
      <Text style={st.clock}>{clockOf(t)}</Text>
    </View>
  );
}

export function Panel({ title, aside, children, style }: { title: string; aside?: React.ReactNode; children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[st.panel, style]}>
      <View style={st.panelHead}>
        <Text style={st.panelTitle} accessibilityRole="header">{title}</Text>
        {aside}
      </View>
      {children}
    </View>
  );
}

export function SourceTag({ source }: { source: Source }) {
  const live = source === 'live';
  return (
    <View style={[st.src, live && { borderColor: C.flow }]}>
      <Text style={[st.srcText, live && { color: C.flow }]}>{live ? 'Live' : 'Simulated'}</Text>
    </View>
  );
}

export function KV({ label, value, watch }: { label: string; value: string; watch?: boolean }) {
  return (
    <View style={st.kv}>
      <Text style={st.kvLabel}>{label}</Text>
      <Text style={[st.kvValue, watch && { color: C.watchInk, backgroundColor: C.watchBg }]}>{value}</Text>
    </View>
  );
}

export const tap = () => { Haptics.selectionAsync().catch(() => {}); };

export function Btn({ label, onPress, danger, primary }: { label: string; onPress: () => void; danger?: boolean; primary?: boolean }) {
  return (
    <Pressable
      onPress={() => { tap(); onPress(); }}
      android_ripple={{ color: danger ? C.tripBg : C.surface2 }}
      hitSlop={6}
      accessibilityRole="button"
      style={({ pressed }) => [
        st.btn,
        danger && { borderColor: C.trip },
        primary && { backgroundColor: C.flow, borderColor: C.flow, minHeight: 52 },
        pressed && { backgroundColor: danger ? C.trip : primary ? '#255fc4' : C.surface2 },
      ]}
    >
      {({ pressed }) => (
        <Text style={[st.btnText, danger && { color: pressed ? '#fff' : C.trip }, primary && { color: '#fff', textAlign: 'center' }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function BalanceStats() {
  const p = useStore((s) => s.plant);
  const batt = p.battery.powerMw;
  const items: { label: string; value: string; unit: string; tone?: 'flow' | 'watch' }[] = [
    { label: 'Demand', value: fmt(p.demandMw), unit: 'MW' },
    { label: 'Turbines', value: fmt(p.outputMw), unit: 'MW' },
    { label: 'Battery', value: fmt(Math.abs(batt)), unit: batt > 5 ? 'MW out' : batt < -5 ? 'MW in' : 'MW', tone: batt > 5 ? 'flow' : undefined },
    { label: 'Grid import', value: fmt(p.gridMw), unit: 'MW', tone: p.gridMw > 1 ? 'watch' : undefined },
    { label: 'Reserve', value: fmt(p.reserveMw), unit: 'MW' },
    { label: 'Battery charge', value: fmt(p.battery.socPct), unit: '%' },
  ];
  return (
    <View style={st.stats}>
      {items.map((it) => (
        <View key={it.label} style={[st.stat, it.tone === 'watch' && { backgroundColor: C.watchBg, borderTopColor: C.watch }]}>
          <Text style={st.statLabel}>{it.label}</Text>
          <Text style={[st.statValue, it.tone === 'flow' && { color: C.flow }]}>
            {it.value}<Text style={st.statUnit}> {it.unit}</Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

const SERIES: { key: keyof HistoryPoint; label: string; color: string }[] = [
  { key: 'demandMw', label: 'Demand', color: C.ink },
  { key: 'outputMw', label: 'Turbines', color: C.flow },
  { key: 'batteryMw', label: 'Battery', color: C.battery },
  { key: 'gridMw', label: 'Grid', color: C.watch },
];

export function BalanceChart({ history }: { history: HistoryPoint[] }) {
  const [w, setW] = useState(300);
  const h = 170, pad = { l: 40, r: 6, t: 8, b: 20 };
  const n = Math.max(history.length, 2);
  const x = (i: number) => pad.l + (i / (n - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / 2700) * (h - pad.t - pad.b);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ marginTop: 12 }} accessibilityLabel="Power balance, last five minutes">
      <Svg width={w} height={h}>
        {[0, 900, 1800, 2700].map((v) => (
          <SvgText key={`t${v}`} x={pad.l - 6} y={y(v) + 4} fontSize={10} fill={C.ink2} textAnchor="end" fontFamily={F.num}>{fmt(v)}</SvgText>
        ))}
        {[0, 900, 1800, 2700].map((v) => (
          <Line key={`l${v}`} x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke={C.rule} strokeDasharray="2 4" />
        ))}
        {SERIES.map((s) => (
          <Polyline
            key={s.key}
            points={history.map((p, i) => `${x(i)},${y(Math.max(0, p[s.key] as number))}`).join(' ')}
            fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round"
          />
        ))}
        <SvgText x={pad.l} y={h - 4} fontSize={10} fill={C.ink2} fontFamily={F.num}>5 min ago</SvgText>
        <SvgText x={w - pad.r} y={h - 4} fontSize={10} fill={C.ink2} textAnchor="end" fontFamily={F.num}>now</SvgText>
      </Svg>
      <View style={st.legend}>
        {SERIES.map((s) => (
          <View key={s.key} style={st.legendItem}>
            <View style={[st.legendSwatch, { backgroundColor: s.color }]} />
            <Text style={st.legendText}>{s.label}</Text>
          </View>
        ))}
        <Text style={[st.legendText, { marginLeft: 'auto' }]}>MW</Text>
      </View>
    </View>
  );
}

function tileColors(status: Turbine['status']) {
  if (status === 'watch') return { bg: C.watchBg, border: C.watch, ink: C.ink, bar: C.watch };
  if (status === 'tripped') return { bg: C.trip, border: C.trip, ink: '#fff', bar: '#fff' };
  return { bg: C.surface, border: C.rule, ink: C.ink, bar: C.ink2 };
}

export function TurbineTiles({ onPick }: { onPick?: () => void }) {
  const turbines = useStore((s) => s.plant.turbines);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: S.gutter }}>
      {turbines.map((tb) => {
        const c = tileColors(tb.status);
        const on = tb.status === 'running' || tb.status === 'watch';
        const isSel = selected === tb.id;
        return (
          <Pressable
            key={tb.id}
            onPress={() => { tap(); select(tb.id); onPick?.(); }}
            android_ripple={{ color: C.surface2 }}
            accessibilityRole="button"
            accessibilityState={{ selected: isSel }}
            accessibilityLabel={`${tb.id}, ${tb.status}, ${fmt(tb.outputMw)} megawatts`}
            style={[st.tile, { backgroundColor: c.bg, borderColor: isSel ? C.flow : c.border, opacity: tb.status === 'offline' ? 0.6 : 1 }, isSel && { borderWidth: 2 }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[st.tileId, { color: c.ink }]}>{tb.id}</Text>
              {tb.source === 'live' && <View style={st.liveDot} accessibilityLabel="live sensors" />}
            </View>
            <Text style={[st.tileMw, { color: c.ink }]}>{on ? fmt(tb.outputMw) : '0'}<Text style={[st.statUnit, { color: c.ink }]}> MW</Text></Text>
            <Text style={[st.tileMeta, { color: c.ink }]}>{on ? `wear ${fmt(tb.features.toolWearMin)} min` : tb.status}</Text>
            <View style={st.tileBar}><View style={{ height: 4, width: `${(tb.outputMw / tb.ratedMw) * 100}%`, backgroundColor: c.bar }} /></View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Spark({ values }: { values: number[] }) {
  const w = 110, h = 26;
  if (values.length < 2) return <View style={{ width: w, height: h }} />;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - Math.min(1, Math.max(0, v)) * h;
  return (
    <Svg width={w} height={h}>
      <Line x1={0} x2={w} y1={y(WATCH_RISK)} y2={y(WATCH_RISK)} stroke={C.watch} strokeDasharray="3 3" />
      <Polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={C.flow} strokeWidth={1.5} />
    </Svg>
  );
}

const K = 273.15;
export function FeatureRows({ f }: { f: Features }) {
  return (
    <View>
      <KV label="Type (quality grade)" value={f.type} />
      <KV label="Air temperature" value={`${fmt(f.airTempK, 1)} K (${fmt(f.airTempK - K, 1)} °C)`} />
      <KV label="Process temperature" value={`${fmt(f.processTempK, 1)} K (${fmt(f.processTempK - K, 1)} °C)`} />
      <KV label="Rotational speed" value={`${fmt(f.rpm)} rpm`} />
      <KV label="Torque" value={`${fmt(f.torqueNm, 1)} Nm`} />
      <KV label="Tool wear" value={`${fmt(f.toolWearMin)} min`} />
    </View>
  );
}

export function TurbineDetail() {
  const plant = useStore((s) => s.plant);
  const selected = useStore((s) => s.selected);
  const trip = useStore((s) => s.trip);
  const reset = useStore((s) => s.reset);
  const picked = plant.turbines.find((x) => x.id === selected);
  const tb = picked ?? plant.turbines.find((x) => x.id === plant.predictions[0]?.turbineId) ?? plant.turbines[0];
  const pred = plant.predictions.find((p) => p.turbineId === tb.id);
  const statusBg = tb.status === 'watch' ? C.watch : tb.status === 'tripped' ? C.trip : C.surface2;
  return (
    <View>
      {!picked && <Text style={st.hint}>Showing the unit most at risk. Tap any unit to switch.</Text>}
      <View style={st.detailHead}>
        <Text style={st.detailId}>{tb.id}</Text>
        <View style={[st.status, { backgroundColor: statusBg }]}>
          <Text style={[st.statusText, tb.status === 'tripped' && { color: '#fff' }]}>{tb.status[0].toUpperCase() + tb.status.slice(1)}</Text>
        </View>
      </View>
      {tb.tripCause && <Text style={st.cause}>{tb.tripCause}</Text>}
      <KV label="Electrical output" value={`${fmt(tb.outputMw)} / ${fmt(tb.capacityMw)} MW`} />
      <KV label="Shaft power (torque × speed)" value={`${fmt(tb.shaftPowerKw, 2)} kW`} />
      <View style={[st.panelHead, { marginTop: 14, marginBottom: 4 }]}>
        <Text style={st.panelTitle}>Machine readings</Text>
        <SourceTag source={tb.source} />
      </View>
      <FeatureRows f={tb.features} />
      <Text style={[st.small, { marginTop: 6 }]}>
        {tb.source === 'live' ? 'Measured live by the sensor board.' : `Dataset row ${tb.row === null ? '' : (tb.row + 1).toLocaleString('en-US')} of the AI4I 2020 data.`}
      </Text>
      <View style={st.trendRow}>
        <Text style={st.small}>Failure risk, last 3 min</Text>
        <Spark values={plant.riskHistory[tb.id] ?? []} />
      </View>
      {pred && pred.risk >= 0.2 && <Text style={st.forecast}>{pred.detail}</Text>}
      {pred && <Text style={[st.small, { marginTop: 6 }]}>Model: {Math.round(pred.probability * 100)}% failure probability on this reading.</Text>}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {(tb.status === 'running' || tb.status === 'watch') && (
          <Btn
            danger
            label={`Trip ${tb.id}`}
            onPress={() => Alert.alert(`Trip ${tb.id}?`, 'The unit drops to 0 MW and the battery covers the gap.', [
              { text: 'Cancel', style: 'cancel' },
              { text: `Trip ${tb.id}`, style: 'destructive', onPress: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); trip(tb.id); } },
            ])}
          />
        )}
        {tb.status === 'tripped' && <Btn label="Reset and restart" onPress={() => reset(tb.id)} />}
      </View>
    </View>
  );
}

export function Predictions() {
  const preds = useStore((s) => s.plant.predictions);
  const select = useStore((s) => s.select);
  const flagged = preds.filter((p) => p.risk >= 0.2 || (p.minutesToFailure !== null && p.minutesToFailure <= 5));
  return (
    <View style={{ gap: 6 }}>
      {flagged.length === 0 && <Text style={st.small}>No unit is heading toward a failure in the next few minutes.</Text>}
      {flagged.map((p) => (
        <Pressable key={p.turbineId} onPress={() => { tap(); select(p.turbineId); }} android_ripple={{ color: C.surface }} style={st.pred} accessibilityRole="button">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={st.predId}>{p.turbineId}</Text>
            <Text style={[st.body, { flex: 1, textAlign: 'right' }]}>
              {p.mode ? `${FAILURE_NAME[p.mode]}${p.minutesToFailure !== null ? ` in ~${fmt(p.minutesToFailure, 1)} min` : ''}` : `${Math.round(p.probability * 100)}% failure probability`}
            </Text>
          </View>
          <View style={st.meter}><View style={{ height: 6, width: `${p.risk * 100}%`, backgroundColor: p.risk > 0.6 ? C.trip : p.risk > 0.3 ? C.watch : C.ink2 }} /></View>
        </Pressable>
      ))}
      <Text style={[st.small, { marginTop: 4 }]}>
        Decision tree trained on {MODEL_METRICS.train_rows.toLocaleString('en-US')} rows of the AI4I 2020 dataset. On {MODEL_METRICS.test_rows.toLocaleString('en-US')} unseen rows it caught {Math.round(MODEL_METRICS.recall * 100)}% of failures at {Math.round(MODEL_METRICS.precision * 100)}% precision.
      </Text>
    </View>
  );
}

export function Sensors() {
  const board = useStore((s) => s.plant.board);
  return (
    <View>
      {board.features ? <FeatureRows f={board.features} /> : <Text style={st.small}>No readings received yet.</Text>}
      <Text style={[st.small, { marginTop: 8 }]}>
        {board.source === 'live'
          ? `The board's six readings drive ${LIVE_SENSOR_UNIT} directly.`
          : `Not connected. ${LIVE_SENSOR_UNIT} is replaying the dataset until the board posts readings.`}
      </Text>
    </View>
  );
}

const SEV = {
  info: { bg: C.surface2, mark: C.rule },
  watch: { bg: C.watchBg, mark: C.watch },
  trip: { bg: C.tripBg, mark: C.trip },
};

export function Alarms({ events, limit = 8, empty = 'No alarms.' }: { events: PlantEvent[]; limit?: number; empty?: string }) {
  if (!events.length) return <Text style={st.small}>{empty}</Text>;
  return (
    <View style={{ gap: 3 }}>
      {events.slice(0, limit).map((e) => (
        <View key={e.id} style={[st.alarm, { backgroundColor: SEV[e.severity].bg }]}>
          <View style={[st.alarmMark, { backgroundColor: SEV[e.severity].mark }, e.severity !== 'info' && { borderRadius: 1, transform: [{ rotate: '45deg' }] }]} />
          <Text style={st.alarmTime}>{clockOf(e.t)}</Text>
          <Text style={[st.body, { flex: 1 }]}>{e.text}</Text>
        </View>
      ))}
    </View>
  );
}

export const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: S.gutter, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.rule },
  brand: { fontFamily: F.numBold, fontSize: 20, color: C.ink },
  screen: { fontFamily: F.regular, fontSize: 13, color: C.ink2 },
  clock: { fontFamily: F.num, fontSize: 16, color: C.ink, fontVariant: ['tabular-nums'] },
  alarmCount: { backgroundColor: C.trip, paddingHorizontal: 8, paddingVertical: 3, borderRadius: S.radiusS },
  alarmCountText: { fontFamily: F.semibold, fontSize: 12, color: '#fff' },
  panel: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.rule, borderRadius: S.radius, padding: 14 },
  panelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  panelTitle: { fontFamily: F.semibold, fontSize: 15, color: C.ink2 },
  src: { borderWidth: 1, borderColor: C.rule, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  srcText: { fontFamily: F.semibold, fontSize: 12, color: C.ink2 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.surface2, gap: 12 },
  kvLabel: { fontFamily: F.regular, fontSize: 15, color: C.ink2, flexShrink: 1 },
  kvValue: { fontFamily: F.num, fontSize: 16, color: C.ink, fontVariant: ['tabular-nums'], paddingHorizontal: 2 },
  btn: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: C.ink, borderRadius: S.radiusS, paddingHorizontal: 16, backgroundColor: C.surface, overflow: 'hidden' },
  btnText: { fontFamily: F.semibold, fontSize: 15, color: C.ink },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  stat: { width: '50%', borderTopWidth: 1, borderTopColor: C.rule, paddingTop: 6, paddingRight: 8 },
  statLabel: { fontFamily: F.regular, fontSize: 13, color: C.ink2 },
  statValue: { fontFamily: F.num, fontSize: 24, color: C.ink, fontVariant: ['tabular-nums'] },
  statUnit: { fontFamily: F.medium, fontSize: 13, color: C.ink2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6, alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 3 },
  legendText: { fontFamily: F.regular, fontSize: 13, color: C.ink2 },
  tile: { width: 136, minHeight: 96, padding: 12, borderWidth: 1, borderRadius: S.radiusS, gap: 1, overflow: 'hidden' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.flow },
  tileId: { fontFamily: F.bold, fontSize: 13 },
  tileMw: { fontFamily: F.num, fontSize: 22, fontVariant: ['tabular-nums'] },
  tileMeta: { fontFamily: F.regular, fontSize: 12, opacity: 0.8, textTransform: 'capitalize' },
  tileBar: { height: 4, backgroundColor: C.surface2, marginTop: 6, overflow: 'hidden' },
  hint: { fontFamily: F.regular, fontSize: 13, color: C.ink2, marginBottom: 8 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  detailId: { fontFamily: F.numBold, fontSize: 24, color: C.ink },
  status: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: S.radiusS },
  statusText: { fontFamily: F.semibold, fontSize: 13, color: C.ink },
  cause: { fontFamily: F.regular, fontSize: 14, color: C.ink2, marginBottom: 6 },
  trendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  small: { fontFamily: F.regular, fontSize: 13, color: C.ink2 },
  body: { fontFamily: F.regular, fontSize: 15, color: C.ink },
  forecast: { fontFamily: F.medium, fontSize: 14, color: C.watchInk, backgroundColor: C.watchBg, borderColor: C.watch, borderWidth: 1, borderRadius: S.radiusS, padding: 10, marginTop: 10 },
  pred: { minHeight: 56, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.rule, borderRadius: S.radiusS, padding: 12, gap: 6, overflow: 'hidden' },
  predId: { fontFamily: F.bold, fontSize: 15, color: C.ink },
  meter: { height: 6, backgroundColor: C.rule, overflow: 'hidden', borderRadius: 3 },
  alarm: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 7, borderRadius: S.radiusS },
  alarmMark: { width: 8, height: 8, borderRadius: 4 },
  alarmTime: { fontFamily: F.num, fontSize: 13, color: C.ink2, fontVariant: ['tabular-nums'] },
});
