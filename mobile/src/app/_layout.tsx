import {
  Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold,
} from '@expo-google-fonts/barlow';
import {
  BarlowSemiCondensed_500Medium, BarlowSemiCondensed_600SemiBold, BarlowSemiCondensed_700Bold,
} from '@expo-google-fonts/barlow-semi-condensed';
import { useFonts } from 'expo-font';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { startClock } from '@/state/store';
import { C } from '@/ui/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold,
    BarlowSemiCondensed_500Medium, BarlowSemiCondensed_600SemiBold, BarlowSemiCondensed_700Bold,
  });
  useEffect(() => startClock(), []);
  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);
  if (!loaded && !error) return null;

  return (
    <>
      <StatusBar style="dark" />
      <NativeTabs
        backgroundColor={C.surface}
        indicatorColor={C.panel}
        labelStyle={{ default: { color: C.ink2 }, selected: { color: C.ink } }}
      >
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={require('@/assets/images/tabIcons/home.png')} renderingMode="template" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="shipments">
          <NativeTabs.Trigger.Label>Shipments</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={require('@/assets/images/tabIcons/explore.png')} renderingMode="template" />
        </NativeTabs.Trigger>
      </NativeTabs>
    </>
  );
}
