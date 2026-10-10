import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useStore } from '@/state/store';
import {
  Alarms, BalanceChart, BalanceStats, Panel, Predictions, Sensors, SourceTag, TopBar, TurbineDetail, TurbineTiles,
} from '@/ui/parts';
import { C, S } from '@/ui/theme';

export default function Dashboard() {
  const history = useStore((s) => s.plant.history);
  const events = useStore((s) => s.plant.events);
  const source = useStore((s) => s.plant.ambient.source);
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.surface }}>
      <TopBar title="Dashboard" />
      <ScrollView style={{ backgroundColor: C.panel }} contentContainerStyle={{ padding: S.gutter, gap: S.gap, paddingBottom: 32 }}>
        <Panel title="Power balance">
          <BalanceStats />
          <BalanceChart history={history} />
        </Panel>
        <View>
          <Panel title="Turbine fleet" style={{ paddingRight: 0 }}>
            <TurbineTiles />
          </Panel>
        </View>
        <Panel title="Selected unit"><TurbineDetail /></Panel>
        <Panel title="Alarms and events"><Alarms events={events} limit={8} /></Panel>
        <Panel title="Overheat forecast"><Predictions /></Panel>
        <Panel title="Site sensors" aside={<SourceTag source={source} />}><Sensors /></Panel>
      </ScrollView>
    </SafeAreaView>
  );
}
