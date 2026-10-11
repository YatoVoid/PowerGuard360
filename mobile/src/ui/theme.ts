// Same tokens as the website: grey structure, one blue for selection and flow, amber and red only for abnormal states.
export const C = {
  panel: '#eceef1',
  surface: '#ffffff',
  surface2: '#f0f2f5',
  ink: '#15191e',
  ink2: '#59616b',
  ink3: '#8b939d',
  rule: '#e0e4e9',
  flow: '#2f6fde',
  accentSoft: '#e8f0fd',
  live: '#1f9d63',
  watch: '#d99a00',
  watchBg: '#fff4d6',
  watchInk: '#7a5600',
  trip: '#d0312d',
  tripBg: '#fde8e7',
  battery: '#3f9d6d',
};

// Same pairing as the website: Archivo for headings and the numbers people scan for, IBM Plex Sans for reading.
export const F = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
  num: 'Archivo_700Bold',
  numBold: 'Archivo_800ExtraBold',
};

export const S = { gutter: 16, gap: 12, radius: 6, radiusS: 3 };

export const fmt = (n: number, d = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export function clockOf(t: number) {
  const base = new Date();
  base.setHours(14, 0, 0, 0);
  return new Date(base.getTime() + t * 1000).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}
