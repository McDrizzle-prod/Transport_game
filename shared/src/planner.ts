// Route planner for the build tools: cheapest buildable path through a list of waypoints.
import { MAX_ROUTE_EDGES, TRANSPORT } from './config';
import { checkRouteTile, crossingOwners, edgeCost, edgeNeeded, planBuild, stepAllowed } from './construction';
import type { ConstructionPlan, TileCheck } from './construction';
import { MinHeap, neighbor, octile, stepLength, tileX, tileY } from './geometry';
import type { PlayerId, TransportKind } from './types';
import type { World } from './world';

export interface RoutePlan {
  path: number[] | null;
  /** Error code when no path was found. */
  error?: 'unreachable' | 'too_long' | 'blocked_endpoint';
  plan?: ConstructionPlan;
}

/** Extra cost factor for changing direction (index = number of 45° steps). Keeps routes straight. */
const TURN_PENALTY: Record<TransportKind, number[]> = {
  road: [0, 0.2, 0.8, 3, Infinity],
  rail: [0, 0.3, 4, Infinity, Infinity],
  canal: [0, 0.2, 1.5, Infinity, Infinity],
};

function searchSegment(
  world: World,
  player: PlayerId,
  kind: TransportKind,
  from: number,
  to: number,
  startDir: number,
  tileCheck: (t: number) => TileCheck,
): { path: number[]; endDir: number } | null {
  const grid = world.grid;
  const unit = TRANSPORT[kind].edgeCost;
  const cheap = unit * 0.15;
  const penalties = TURN_PENALTY[kind];
  const gx = tileX(grid, to);
  const gy = tileY(grid, to);
  // State = tile * 9 + incoming direction (8 = none).
  const startState = from * 9 + (startDir >= 0 ? startDir : 8);
  const g = new Map<number, number>([[startState, 0]]);
  const prev = new Map<number, number>();
  const open = new MinHeap();
  open.push(startState, 0);
  const closed = new Set<number>();
  let found = -1;
  let expanded = 0;
  while (open.size) {
    const state = open.pop();
    if (closed.has(state)) continue;
    closed.add(state);
    const tile = Math.floor(state / 9);
    const inDir = state % 9;
    if (tile === to) {
      found = state;
      break;
    }
    if (++expanded > 200_000) break;
    const base = g.get(state)!;
    for (let d = 0; d < 8; d++) {
      const next = neighbor(grid, tile, d);
      if (next < 0) continue;
      if (next !== to && !tileCheck(next).ok) continue;
      if (!stepAllowed(world, kind, tile, next)) continue;
      let cost: number;
      if (!edgeNeeded(world, kind, tile, next)) cost = cheap * stepLength(grid, tile, next);
      else {
        const existing = world.edgesAt(tile).find(
          (e) => e.kind === kind && (e.a === next || e.b === next) && e.owners.includes(player),
        );
        if (existing) cost = cheap * stepLength(grid, tile, next);
        else {
          if (crossingOwners(world, tile, next)) continue;
          cost = edgeCost(world, kind, tile, next);
        }
      }
      if (inDir !== 8) {
        const diff = Math.min(Math.abs(d - inDir), 8 - Math.abs(d - inDir));
        cost += penalties[diff] * unit;
      }
      if (!Number.isFinite(cost)) continue;
      const nextState = next * 9 + d;
      if (closed.has(nextState)) continue;
      const ng = base + cost;
      if (ng < (g.get(nextState) ?? Infinity)) {
        g.set(nextState, ng);
        prev.set(nextState, state);
        open.push(nextState, ng + octile(tileX(grid, next), tileY(grid, next), gx, gy) * cheap);
      }
    }
  }
  if (found < 0) return null;
  const path = [Math.floor(found / 9)];
  let s = found;
  while (s !== startState) {
    s = prev.get(s)!;
    path.push(Math.floor(s / 9));
  }
  path.reverse();
  return { path, endDir: found % 9 };
}

/**
 * Plans a route of `kind` through the given waypoints (first = start, last = end).
 * Tiles of other players are avoided; the player's own network is reused for free.
 */
export function planRoute(world: World, player: PlayerId, kind: TransportKind, waypoints: number[]): RoutePlan {
  if (waypoints.length < 2) return { path: null, error: 'unreachable' };
  const cache = new Map<number, TileCheck>();
  const tileCheck = (t: number) => {
    let c = cache.get(t);
    if (!c) cache.set(t, (c = checkRouteTile(world, player, kind, t)));
    return c;
  };
  for (const w of waypoints) if (!tileCheck(w).ok) return { path: null, error: 'blocked_endpoint' };

  const path: number[] = [waypoints[0]];
  let dir = -1;
  for (let i = 0; i + 1 < waypoints.length; i++) {
    if (waypoints[i] === waypoints[i + 1]) continue;
    const seg = searchSegment(world, player, kind, waypoints[i], waypoints[i + 1], dir, tileCheck);
    if (!seg) return { path: null, error: 'unreachable' };
    path.push(...seg.path.slice(1));
    dir = seg.endDir;
  }
  // A route may not visit a tile twice (that would need a junction with itself).
  if (path.length < 2 || new Set(path).size !== path.length) return { path: null, error: 'unreachable' };
  if (path.length - 1 > MAX_ROUTE_EDGES) return { path, error: 'too_long' };
  return { path, plan: planBuild(world, player, { type: 'build', kind, path }) };
}
