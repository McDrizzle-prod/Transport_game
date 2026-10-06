// Tile grid helpers. Tiles are addressed by a single index (y * width + x).

export const SQRT2 = Math.SQRT2;

/** 8 neighbour directions clockwise from east. Even index = straight, odd index = diagonal. */
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** The 4 straight directions (indices into DIRS). */
export const STRAIGHT_DIRS = [0, 2, 4, 6] as const;

export interface Grid {
  width: number;
  height: number;
}

export const toIndex = (g: Grid, x: number, y: number): number => y * g.width + x;
export const tileX = (g: Grid, i: number): number => i % g.width;
export const tileY = (g: Grid, i: number): number => Math.floor(i / g.width);
export const inBounds = (g: Grid, x: number, y: number): boolean => x >= 0 && y >= 0 && x < g.width && y < g.height;
export const validTile = (g: Grid, i: number): boolean => Number.isInteger(i) && i >= 0 && i < g.width * g.height;

/** Neighbour of tile `i` in direction `dir`, or -1 when outside the map. */
export function neighbor(g: Grid, i: number, dir: number): number {
  const [dx, dy] = DIRS[dir];
  const x = tileX(g, i) + dx;
  const y = tileY(g, i) + dy;
  return inBounds(g, x, y) ? toIndex(g, x, y) : -1;
}

/** Direction index from a to b when they are neighbours, otherwise -1. */
export function dirBetween(g: Grid, a: number, b: number): number {
  const dx = tileX(g, b) - tileX(g, a);
  const dy = tileY(g, b) - tileY(g, a);
  for (let d = 0; d < 8; d++) {
    if (DIRS[d][0] === dx && DIRS[d][1] === dy) return d;
  }
  return -1;
}

export const isAdjacent = (g: Grid, a: number, b: number): boolean => dirBetween(g, a, b) >= 0;

/** Length of one step between neighbours: 1 straight, √2 diagonal. */
export function stepLength(g: Grid, a: number, b: number): number {
  const dx = Math.abs(tileX(g, b) - tileX(g, a));
  const dy = Math.abs(tileY(g, b) - tileY(g, a));
  return dx === 1 && dy === 1 ? SQRT2 : 1;
}

export function edgeKey(kind: string, a: number, b: number): string {
  return a < b ? `${kind}:${a}:${b}` : `${kind}:${b}:${a}`;
}

/** For a diagonal step a→b: the two tiles of the diagonal that would cross it. */
export function crossingPair(g: Grid, a: number, b: number): [number, number] | null {
  const ax = tileX(g, a);
  const ay = tileY(g, a);
  const bx = tileX(g, b);
  const by = tileY(g, b);
  if (Math.abs(ax - bx) !== 1 || Math.abs(ay - by) !== 1) return null;
  return [toIndex(g, bx, ay), toIndex(g, ax, by)];
}

export const chebyshev = (ax: number, ay: number, bx: number, by: number): number => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

export const euclid = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);

export function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

/** Chebyshev distance from a tile to a rectangle (0 when inside). */
export function distToRect(x: number, y: number, rx: number, ry: number, rw: number, rh: number): number {
  const dx = Math.max(rx - x, 0, x - (rx + rw - 1));
  const dy = Math.max(ry - y, 0, y - (ry + rh - 1));
  return Math.max(dx, dy);
}

/** Binary min-heap of numeric values with numeric priorities (used by A*). */
export class MinHeap {
  private prio: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.vals.length;
  }

  push(value: number, priority: number): void {
    this.prio.push(priority);
    this.vals.push(value);
    let i = this.vals.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.vals[0];
    const lastP = this.prio.pop()!;
    const lastV = this.vals.pop()!;
    if (this.vals.length > 0) {
      this.prio[0] = lastP;
      this.vals[0] = lastV;
      let i = 0;
      const n = this.vals.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.prio[l] < this.prio[m]) m = l;
        if (r < n && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
    [this.vals[a], this.vals[b]] = [this.vals[b], this.vals[a]];
  }
}
