import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ME, useStore } from '@/state/store';
import { tap } from '@/ui/parts';
import { C, F, S } from '@/ui/theme';

// Slides over every screen when a job is assigned to this phone.
export function AlertBanner() {
  const alert = useStore((s) => s.alert);
  const act = useStore((s) => s.act);
  const dismiss = useStore((s) => s.dismissAlert);
  const insets = useSafeAreaInsets();
  if (!alert) return null;
  const tone = alert.priority === 'P1' ? C.trip : alert.priority === 'P2' ? C.watch : C.flow;
  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <View style={[styles.card, { borderTopColor: tone }]}>
        <Text style={styles.kicker}>New maintenance request</Text>
        <Text style={styles.title}>{alert.title}</Text>
        <Text style={styles.body}>{alert.body}</Text>
        <View style={styles.row}>
          <Pressable
            style={[styles.btn, styles.primary]}
            android_ripple={{ color: '#255fc4' }}
            accessibilityRole="button"
            onPress={() => { tap(); act({ type: 'accept', requestId: alert.requestId, engineerId: ME }); dismiss(); router.navigate('/work'); }}
          >
            <Text style={[styles.btnText, { color: '#fff' }]}>Accept</Text>
          </Pressable>
          <Pressable
            style={styles.btn}
            android_ripple={{ color: C.surface2 }}
            accessibilityRole="button"
            onPress={() => { tap(); dismiss(); router.navigate('/work'); }}
          >
            <Text style={styles.btnText}>View job</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: S.gutter, right: S.gutter, zIndex: 100, elevation: 12 },
  card: { backgroundColor: '#fff', borderRadius: 10, borderTopWidth: 5, padding: 16, gap: 4, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 12 },
  kicker: { fontFamily: F.semibold, fontSize: 12, color: C.ink2 },
  title: { fontFamily: F.numBold, fontSize: 22, color: C.ink },
  body: { fontFamily: F.regular, fontSize: 15, color: C.ink, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, minHeight: 50, borderRadius: S.radiusS, borderWidth: 1, borderColor: C.ink, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  primary: { backgroundColor: C.flow, borderColor: C.flow },
  btnText: { fontFamily: F.semibold, fontSize: 16, color: C.ink },
});
