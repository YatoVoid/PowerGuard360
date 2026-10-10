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
        indicatorColor={C.panel}
        labelStyle={{ default: { color: C.ink2 }, selected: { color: C.ink } }}
      >
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={require('@/assets/images/tabIcons/home.png')} renderingMode="template" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="work">
          <NativeTabs.Trigger.Label>Work orders</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon src={require('@/assets/images/tabIcons/explore.png')} renderingMode="template" />
        </NativeTabs.Trigger>
      </NativeTabs>
      <AlertBanner />
    </>
  );
}
