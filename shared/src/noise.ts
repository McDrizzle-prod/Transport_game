// 2D gradient (Perlin) noise with fractal octaves, used for terrain generation.
import { Rng } from './rng';

const GRADIENTS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type Noise2D = (x: number, y: number) => number;

/** Returns noise in roughly [-0.7, 0.7]. */
export function createNoise2D(seed: number): Noise2D {
  const rng = new Rng(seed);
  const p = rng.shuffle(Array.from({ length: 256 }, (_, i) => i));
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const grad = (ix: number, iy: number, dx: number, dy: number) => {
    const g = GRADIENTS[perm[perm[ix & 255] + (iy & 255)] & 7];
    return g[0] * dx + g[1] * dy;
  };

  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const n00 = grad(x0, y0, fx, fy);
    const n10 = grad(x0 + 1, y0, fx - 1, fy);
    const n01 = grad(x0, y0 + 1, fx, fy - 1);
    const n11 = grad(x0 + 1, y0 + 1, fx - 1, fy - 1);
    const u = fade(fx);
    const v = fade(fy);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
  };
}

/** Fractal Brownian motion: several octaves of noise added together. */
export function fbm(noise: Noise2D, x: number, y: number, octaves: number, gain = 0.5, lacunarity = 2): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq + o * 17.3, y * freq - o * 9.1);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
