// Seedable pseudo random numbers so that map generation and turn resolution are reproducible.

/** FNV-1a hash of the given parts; handy to derive independent seeds ("map", "turn 7", ...). */
export function hashSeed(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** mulberry32: float in [0, 1). */
  float(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** Integer in [min, maxInclusive]. */
  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.float() * (maxInclusive - min + 1));
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.float() * items.length)];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}
