import { Archivo_700Bold, Archivo_800ExtraBold } from '@expo-google-fonts/archivo';
import { IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans';
import { useFonts } from 'expo-font';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { prepareNotifications, startClock } from '@/state/store';
import { C } from '@/ui/theme';
import { AlertBanner } from '@/ui/AlertBanner';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Archivo_700Bold, Archivo_800ExtraBold,
    IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold,
  });
  useEffect(() => startClock(), []);
  useEffect(() => { prepareNotifications(); }, []);
  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);
  if (!loaded && !error) return null;

  return (
    <>
      <StatusBar style="dark" />
      <NativeTabs
        backgroundColor={C.surface}
        indicatorColor={C.accentSoft}
        iconColor={{ default: C.ink3, selected: C.flow }}
        labelStyle={{ default: { color: C.ink2 }, selected: { color: C.flow } }}
      >
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>My job</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={require('@/assets/images/tabIcons/job.png')} renderingMode="template" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="plant">
          <NativeTabs.Trigger.Label>Plant</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={require('@/assets/images/tabIcons/plant.png')} renderingMode="template" />
        </NativeTabs.Trigger>
      </NativeTabs>
      <AlertBanner />
    </>
  );
}
