// Mirrors the website's ISA-101 palette: grey at rest, color only for abnormal states.
export const C = {
  panel: '#c9ccc6',
  surface: '#e4e6e1',
  surface2: '#d8dbd5',
  ink: '#1e2321',
  ink2: '#4f5753',
  rule: '#a9aea8',
  flow: '#2f5d8a',
  watch: '#e0a100',
  watchBg: '#f3e6bf',
  watchInk: '#6b4d00',
  trip: '#c8261e',
  tripBg: '#f2d2cf',
  battery: '#6f9a5b',
};

export const F = {
  regular: 'Barlow_400Regular',
  medium: 'Barlow_500Medium',
  semibold: 'Barlow_600SemiBold',
  bold: 'Barlow_700Bold',
  num: 'BarlowSemiCondensed_600SemiBold',
  numBold: 'BarlowSemiCondensed_700Bold',
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
