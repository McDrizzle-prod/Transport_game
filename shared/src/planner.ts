// Route planner for the build tools: cheapest buildable path through a list of waypoints.
// Runs on every pointer move in the client, so the search uses flat typed arrays and lookup
// tables that are computed once per (world, player, transport kind).
import { MAX_ROUTE_EDGES, TERRAIN, TRANSPORT } from './config';
import { checkRouteTile, planBuild } from './construction';
import type { ConstructionPlan } from './construction';
import { DIRS, MinHeap, SQRT2, chebyshev, crossingPair, tileX, tileY } from './geometry';
import { Terrain, TileUse } from './types';
import type { PlayerId, TransportKind } from './types';
import type { World } from './world';

export interface RoutePlan {
  path: number[] | null;
  /** Error code when no path was found. */
  error?: 'unreachable' | 'too_long' | 'blocked_endpoint';
  plan?: ConstructionPlan;
}

/** Extra cost (in units of one flat segment) for changing direction by 45°, 90°, 135°, 180°. */
const TURN_PENALTY: Record<TransportKind, number[]> = {
  road: [0, 0.2, 0.8, 3, Infinity],
  rail: [0, 0.3, 4, Infinity, Infinity],
  canal: [0, 0.2, 1.5, Infinity, Infinity],
};

/** Cost factor of a segment that already exists (or needs no construction): cheap but not free, so routes stay short. */
const REUSE = 0.15;
/** Weight of the distance heuristic (in flat segments). Above the admissible REUSE: faster, near-optimal routes. */
const HEURISTIC = 0.5;
const MAX_EXPANSIONS = 120_000;

interface Tables {
  /** Can the route pass this tile at all (for this player)? */
  passable: Uint8Array;
  /** Terrain cost multiplier of building on the tile (Infinity = impossible). */
  mul: Float32Array;
  /** Tiles where no construction is needed (open water for canals, city streets for roads). */
  free: Uint8Array;
  street: Uint8Array;
  /** Bit d set: the player already has a usable segment of this kind towards direction d. */
  own: Uint8Array;
  /** Bit d set (diagonals): the crossing diagonal already exists, so this diagonal step is impossible. */
  crossed: Uint8Array;
}

const tableCache = new WeakMap<World, Map<string, Tables>>();

function buildTables(world: World, player: PlayerId, kind: TransportKind): Tables {
  let perWorld = tableCache.get(world);
  if (!perWorld) tableCache.set(world, (perWorld = new Map()));
  // Worlds are normally not changed after planning starts; the counts guard against stale tables anyway.
  const { infra, stations } = world.state;
  const key = `${player}|${kind}|${Object.keys(infra.edges).length}|${Object.keys(infra.tiles).length}|${stations.length}|${world.allianceKey(player)}`;
  const cached = perWorld.get(key);
  if (cached) return cached;

  const { map } = world;
  const n = map.width * map.height;
  const passable = new Uint8Array(n);
  const mul = new Float32Array(n);
  const free = new Uint8Array(n);
  const street = new Uint8Array(n);
  const own = new Uint8Array(n);
  const crossed = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    passable[t] = checkRouteTile(world, player, kind, t).ok ? 1 : 0;
    const def = TERRAIN[map.terrain[t] as keyof typeof TERRAIN];
    mul[t] = (kind === 'canal' ? def.canal : def.land) ?? Infinity;
    street[t] = map.use[t] === TileUse.CityStreet ? 1 : 0;
    free[t] = (kind === 'canal' && map.terrain[t] === Terrain.Water) || (kind === 'road' && street[t]) ? 1 : 0;
  }
  const grid = world.grid;
  for (const e of Object.values(world.state.infra.edges)) {
    const dx = tileX(grid, e.b) - tileX(grid, e.a);
    const dy = tileY(grid, e.b) - tileY(grid, e.a);
    const d = DIRS.findIndex(([x, y]) => x === dx && y === dy);
    if (d < 0) continue;
    const back = (d + 4) % 8;
    if (e.kind === kind && world.canUse(e.owners, player)) {
      own[e.a] |= 1 << d;
      own[e.b] |= 1 << back;
    }
    if (d % 2 === 1) {
      // A diagonal edge blocks the diagonal step that would cross it.
      const pair = crossingPair(grid, e.a, e.b);
      if (pair) {
        const [c, f] = pair;
        const cd = DIRS.findIndex(([x, y]) => x === tileX(grid, f) - tileX(grid, c) && y === tileY(grid, f) - tileY(grid, c));
        crossed[c] |= 1 << cd;
        crossed[f] |= 1 << ((cd + 4) % 8);
      }
    }
  }
  const tables = { passable, mul, free, street, own, crossed };
  perWorld.set(key, tables);
  return tables;
}

function searchSegment(
  world: World,
  kind: TransportKind,
  tables: Tables,
  from: number,
  to: number,
  startDir: number,
): { path: number[]; endDir: number } | null {
  const { width: W, height: H } = world.map;
  const n = W * H;
  const { passable, mul, free, street, own, crossed } = tables;
  const unit = TRANSPORT[kind].edgeCost;
  const penalties = TURN_PENALTY[kind];
  const gx = to % W;
  const gy = (to / W) | 0;
  const g = new Float64Array(n * 9).fill(Infinity);
  const prev = new Int32Array(n * 9).fill(-1);
  const closed = new Uint8Array(n * 9);
  const startState = from * 9 + (startDir >= 0 ? startDir : 8);
  g[startState] = 0;
  const open = new MinHeap();
  open.push(startState, 0);
  let found = -1;
  let expanded = 0;
  while (open.size) {
    const state = open.pop();
    if (closed[state]) continue;
    closed[state] = 1;
    const tile = (state / 9) | 0;
    const inDir = state % 9;
    if (tile === to) {
      found = state;
      break;
    }
    if (++expanded > MAX_EXPANSIONS) break;
    const x = tile % W;
    const y = (tile / W) | 0;
    const base = g[state];
    for (let d = 0; d < 8; d++) {
      const nx = x + DIRS[d][0];
      const ny = y + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const next = ny * W + nx;
      if (next !== to && !passable[next]) continue;
      const diagonal = d % 2 === 1;
      // City streets form a straight grid: no diagonal short cuts between two street tiles.
      if (diagonal && kind === 'road' && street[tile] && street[next]) continue;
      const len = diagonal ? SQRT2 : 1;
      let cost: number;
      if ((free[tile] && free[next]) || own[tile] & (1 << d)) cost = unit * REUSE * len;
      else {
        if (diagonal && crossed[tile] & (1 << d)) continue;
        const m = Math.max(free[tile] ? 0 : mul[tile], free[next] ? 0 : mul[next]);
        if (!Number.isFinite(m)) continue;
        cost = unit * m * len;
      }
      if (inDir !== 8) {
        const diff = Math.min(Math.abs(d - inDir), 8 - Math.abs(d - inDir));
        const p = penalties[diff];
        if (!Number.isFinite(p)) continue;
        cost += p * unit;
      }
      const nextState = next * 9 + d;
      if (closed[nextState]) continue;
      const ng = base + cost;
      if (ng < g[nextState]) {
        g[nextState] = ng;
        prev[nextState] = state;
        const dx = Math.abs(nx - gx);
        const dy = Math.abs(ny - gy);
        const h = (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * unit * HEURISTIC;
        open.push(nextState, ng + h);
      }
    }
  }
  if (found < 0) return null;
  const path = [(found / 9) | 0];
  let s = found;
  while (s !== startState) {
    s = prev[s];
    path.push((s / 9) | 0);
  }
  path.reverse();
  return { path, endDir: found % 9 };
}

/**
 * Plans a route of `kind` through the given waypoints (first = start, last = end).
 * Tiles of other players are avoided; the player's own network is reused (almost) for free.
 */
export function planRoute(world: World, player: PlayerId, kind: TransportKind, waypoints: number[]): RoutePlan {
  if (waypoints.length < 2) return { path: null, error: 'unreachable' };
  for (const w of waypoints) if (!checkRouteTile(world, player, kind, w).ok) return { path: null, error: 'blocked_endpoint' };
  // A route needs at least one segment per step of Chebyshev distance.
  let minEdges = 0;
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    minEdges += chebyshev(tileX(world.grid, a), tileY(world.grid, a), tileX(world.grid, b), tileY(world.grid, b));
  }
  if (minEdges > MAX_ROUTE_EDGES) return { path: null, error: 'too_long' };

  const tables = buildTables(world, player, kind);
  const path: number[] = [waypoints[0]];
  let dir = -1;
  for (let i = 0; i + 1 < waypoints.length; i++) {
    if (waypoints[i] === waypoints[i + 1]) continue;
    const seg = searchSegment(world, kind, tables, waypoints[i], waypoints[i + 1], dir);
    if (!seg) return { path: null, error: 'unreachable' };
    path.push(...seg.path.slice(1));
    dir = seg.endDir;
  }
  // A route may not visit a tile twice (that would need a junction with itself).
  if (path.length < 2 || new Set(path).size !== path.length) return { path: null, error: 'unreachable' };
  if (path.length - 1 > MAX_ROUTE_EDGES) return { path, error: 'too_long' };
  return { path, plan: planBuild(world, player, { type: 'build', kind, path }) };
}
