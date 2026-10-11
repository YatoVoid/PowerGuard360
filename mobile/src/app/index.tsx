import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { REPAIR_S } from '@engine/sim/engine';
import { UNIT_X, assetLabel, pathLength } from '@engine/sim/site';
import type { MaintenanceRequest, PlantState } from '@engine/types';
import { ME, SHAKE_STEP_M, myJob, useStore } from '@/state/store';
import { Btn, KV, Panel, TopBar, st, tap } from '@/ui/parts';
import { C, F, S, fmt } from '@/ui/theme';

const PRIO: Record<MaintenanceRequest['priority'], { bg: string; ink: string }> = {
  P1: { bg: C.trip, ink: '#fff' },
  P2: { bg: C.watch, ink: '#2b1d00' },
  P3: { bg: '#e8f0fd', ink: C.flow },
};

function Prio({ p }: { p: MaintenanceRequest['priority'] }) {
  return (
    <View style={[styles.prio, { backgroundColor: PRIO[p].bg }]}>
      <Text style={[styles.prioText, { color: PRIO[p].ink }]}>{p}</Text>
    </View>
  );
}

const STATUS: Record<MaintenanceRequest['status'], string> = {
  open: 'Waiting for an engineer',
  dispatched: 'Assigned to you. Accept to start.',
  'en-route': 'Walk to the asset',
  'on-site': 'You are at the asset',
  repairing: 'Repair in progress',
  resolved: 'Fixed',
  cancelled: 'Cancelled by the control room',
};

const eta = (min: number) => (min < 1 ? `${Math.max(1, Math.round(min * 60))} s` : `${fmt(min, 1)} min`);

// Top-down plan of the site: turbine row, condenser, switchyard, data center, control room, and the route to the job.
function SiteMap({ plant, job }: { plant: PlantState; job?: MaintenanceRequest }) {
  const me = plant.engineers.find((e) => e.id === ME);
  const statusFill = (s: string) => (s === 'tripped' ? C.trip : s === 'watch' ? C.watch : '#c9cfd6');
  return (
    <View style={styles.map} accessibilityLabel={job ? `Site map with your route to ${job.asset}` : 'Site map'}>
      <Svg width="100%" height="100%" viewBox="-195 -125 390 225" preserveAspectRatio="xMidYMid meet">
        <Rect x={-190} y={-118} width={380} height={214} fill="#eef0f3" stroke="#d6dbe1" />
        <Line x1={-190} x2={190} y1={38} y2={38} stroke="#c8ced6" strokeWidth={6} />
        <Rect x={-178} y={-86} width={32} height={62} fill="#dfe3e8" />
        <SvgText x={-162} y={-90} fontSize={7} fill={C.ink2} textAnchor="middle" fontFamily={F.regular}>Condenser</SvgText>
        <Rect x={126} y={-79} width={52} height={68} fill="#dfe3e8" />
        <SvgText x={152} y={-83} fontSize={7} fill={C.ink2} textAnchor="middle" fontFamily={F.regular}>Switchyard</SvgText>
        <Rect x={-75} y={46} width={150} height={32} fill="#e5e8ec" />
        <SvgText x={0} y={66} fontSize={8} fill={C.ink2} textAnchor="middle" fontFamily={F.regular}>AI data center</SvgText>
        <Rect x={-135} y={64} width={30} height={16} fill="#d9dde2" />
        <SvgText x={-120} y={91} fontSize={7} fill={C.ink2} textAnchor="middle" fontFamily={F.regular}>Control room</SvgText>
        {plant.turbines.map((tb, i) => {
          const target = job?.asset === tb.id;
          return (
            <G key={tb.id}>
              <Rect x={UNIT_X(i) - 5.5} y={-76} width={11} height={67} fill={statusFill(tb.status)} stroke={target ? C.flow : 'none'} strokeWidth={target ? 2.5 : 0} />
              <SvgText x={UNIT_X(i)} y={0} fontSize={7} fill={target ? C.flow : C.ink2} textAnchor="middle" fontFamily={F.semibold}>{tb.id.slice(3)}</SvgText>
            </G>
          );
        })}
        {job && job.path.length > 1 && (
          <Polyline points={job.path.map(([x, z]) => `${x},${z}`).join(' ')} fill="none" stroke={C.flow} strokeWidth={2} strokeDasharray="5 4" />
        )}
        {me && (
          <G>
            <Circle cx={me.pos[0]} cy={me.pos[1]} r={9} fill={C.flow} opacity={0.18} />
            <Circle cx={me.pos[0]} cy={me.pos[1]} r={4.5} fill={C.flow} stroke="#fff" strokeWidth={1.5} />
          </G>
        )}
      </Svg>
    </View>
  );
}

function JobCard({ job }: { job: MaintenanceRequest }) {
  const act = useStore((s) => s.act);
  const shake = useStore((s) => s.shake);
  const startShake = useStore((s) => s.startShake);
  const stopShake = useStore((s) => s.stopShake);
  // Stop listening once the walk is over, wherever that happened.
  useEffect(() => { if (job.status !== 'en-route') stopShake(); }, [job.status, stopShake]);
  const me = useStore((s) => s.plant.engineers.find((e) => e.id === ME));
  const leftM = (1 - job.progress) * pathLength(job.path);
  const gas = useStore((s) => s.plant.gas);
  return (
    <Panel title="Your job" aside={<Prio p={job.priority} />}>
      <View style={st.detailHead}>
        <Text style={st.detailId}>{job.asset.startsWith('GT-') ? job.asset : assetLabel(job.asset)}</Text>
        <Text style={st.small}>{job.id}</Text>
      </View>
      <View style={styles.check}>
        <Text style={styles.checkLabel}>What to check</Text>
        <Text style={st.body}>{job.reason}</Text>
      </View>
      {job.basis && <Text style={[st.small, { marginBottom: 12 }]}>Why it was flagged: {job.basis.detail}</Text>}
      {job.asset === 'gas' && gas.connected && <KV label="Air quality now" value={`${gas.qualityPct}% of clean air`} watch={gas.level !== 'good'} />}
      <Text style={styles.status}>{STATUS[job.status]}</Text>

      {job.status === 'dispatched' && (
        <Btn label="Accept job" primary onPress={() => act({ type: 'accept', requestId: job.id, engineerId: ME })} />
      )}

      {job.status === 'en-route' && (
        <View style={{ gap: 10 }}>
          <KV label="Distance left on site" value={`${fmt(leftM)} m`} />
          <KV label="At walking pace" value={eta(job.etaMin - REPAIR_S / 60)} />
          <View style={[st.meter, { height: 6 }]}><View style={{ height: 6, width: `${job.progress * 100}%`, backgroundColor: C.flow }} /></View>
          {shake ? (
            <View style={styles.shakeBox}>
              <Text style={styles.shakeBig}>{shake.status === 'unavailable' ? 'No motion sensor' : 'Shake your phone to walk'}</Text>
              <Text style={st.body}>
                {shake.status === 'unavailable'
                  ? 'This phone has no accelerometer. Use auto walk instead.'
                  : `${shake.steps} ${shake.steps === 1 ? 'stride' : 'strides'}, ${fmt(shake.steps * SHAKE_STEP_M)} m on site. The control room sees you move.`}
              </Text>
              <Btn label="Stop" onPress={stopShake} />
            </View>
          ) : (
            <>
              <Btn label="Shake to walk" primary onPress={startShake} />
              <Text style={st.small}>Each shake is one {SHAKE_STEP_M} m stride on site.</Text>
            </>
          )}
          <Btn
            label={me?.autoWalk ? 'Stop auto walk' : 'Auto walk instead'}
            onPress={() => act({ type: 'autoWalk', engineerId: ME, on: !me?.autoWalk })}
          />
        </View>
      )}

      {job.status === 'repairing' && (
        <View style={{ gap: 8 }}>
          <KV label="Time left" value={`${job.repairLeftS} s`} />
          <View style={[st.meter, { height: 6 }]}><View style={{ height: 6, width: `${(1 - job.repairLeftS / REPAIR_S) * 100}%`, backgroundColor: C.flow }} /></View>
        </View>
      )}
    </Panel>
  );
}

export default function MyJob() {
  const plant = useStore((s) => s.plant);
  const link = useStore((s) => s.link);
  const job = myJob(plant);
  const history = plant.requests.filter((r) => r.engineerId === ME && (r.status === 'resolved' || r.status === 'cancelled')).reverse();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.surface }}>
      <TopBar title="My job" />
      <ScrollView style={{ backgroundColor: C.panel }} contentContainerStyle={{ padding: S.gutter, gap: S.gap, paddingBottom: 32 }}>
        {link !== 'live' && (
          <View style={styles.link}>
            <Text style={st.small}>Not connected to the plant server, so this is a local copy of the plant and the control room can't see you.</Text>
          </View>
        )}
        <SiteMap plant={plant} job={job} />
        {job ? <JobCard job={job} /> : (
          <Panel title="Your job">
            <Text style={st.body}>No job assigned. When the sensors catch a problem or the control room asks for you, this phone buzzes and the job appears here.</Text>
          </Panel>
        )}
        <Panel title="Completed">
          {history.length === 0 ? <Text style={st.small}>Nothing yet.</Text> : history.slice(0, 8).map((r) => (
            <View key={r.id} style={styles.histRow}>
              <Prio p={r.priority} />
              <Text style={[st.body, { flex: 1 }]}>{r.asset}: {r.reason}</Text>
              <Text style={st.small}>{r.status === 'resolved' ? 'Fixed' : 'Cancelled'}</Text>
            </View>
          ))}
        </Panel>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  map: { height: 210, backgroundColor: C.surface, borderWidth: 1, borderColor: C.rule, borderRadius: S.radius, overflow: 'hidden', padding: 4 },
  prio: { minWidth: 30, height: 22, borderRadius: 3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  prioText: { fontFamily: F.bold, fontSize: 12 },
  status: { fontFamily: F.semibold, fontSize: 16, color: C.ink, marginBottom: 12 },
  check: { borderLeftWidth: 3, borderLeftColor: C.trip, backgroundColor: C.surface2, borderRadius: S.radiusS, padding: 10, marginBottom: 12 },
  checkLabel: { fontFamily: F.semibold, fontSize: 12, color: C.ink2, marginBottom: 2 },
  shakeBox: { gap: 8, padding: 12, borderRadius: S.radiusS, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: '#b9cff5' },
  shakeBig: { fontFamily: F.numBold, fontSize: 18, color: C.flow },
  link: { padding: 10, borderRadius: S.radiusS, borderWidth: 1, borderColor: C.watch, backgroundColor: C.watchBg },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.surface2 },
});
