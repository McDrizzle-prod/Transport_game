export type RGB = [number, number, number];

export const TERRAIN_RGB = {
  grass: [124, 163, 78] as RGB,
  grassLight: [144, 178, 92] as RGB,
  sand: [218, 203, 156] as RGB,
  forestFloor: [100, 140, 68] as RGB,
  hills: [150, 154, 96] as RGB,
  hillsDry: [171, 162, 112] as RGB,
  mountain: [158, 150, 138] as RGB,
  peak: [222, 217, 208] as RGB,
  waterShallow: [80, 148, 194] as RGB,
  waterDeep: [36, 96, 144] as RGB,
};

export const INFRA = {
  asphalt: '#55585c',
  roadEdge: '#3d3f42',
  roadLine: '#efe7cf',
  street: '#9a9893',
  streetCasing: '#e7e1d3',
  ballast: '#8b8173',
  sleeper: '#5b4130',
  rail: '#d6d6d6',
  railDark: '#4b4b4b',
  canalStone: '#9b9384',
  canalWater: '#4f8fc2',
  bridge: '#6b5a48',
};

export const ROOFS = ['#b4573f', '#9b3b2f', '#6f7377', '#8b5e45', '#59606b', '#a8674a'];

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Deterministic pseudo random number in [0, 1) for a tile (and an optional salt). */
export function hash01(i: number, salt = 0): number {
  let h = (Math.imul(i, 374761393) + Math.imul(salt + 1, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
