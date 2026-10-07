// Finding routes for vehicles over a player's network (roads, rails, water + canals).
import { STRAIGHT_DIRS, MinHeap, neighbor, octile, stepLength, tileX, tileY } from './geometry';
import { Terrain, TileUse } from './types';
import type { Edge, PlayerId, StationKind } from './types';
import type { World } from './world';

export interface Route {
  tiles: number[];
  /** Cumulative distance at each tile (cum[0] = 0, cum[last] = length). */
  cum: number[];
  length: number;
}

/** Whether a player may drive over an edge (own or allied). */
export function edgeUsable(world: World, edge: Edge, player: PlayerId): boolean {
  return world.canUse(edge.owners, player);
}

const isWater = (world: World, t: number) => world.map.terrain[t] === Terrain.Water;
const isStreet = (world: World, t: number) => world.map.use[t] === TileUse.CityStreet;

/**
 * Calls `visit` for every tile a vehicle of the given kind can move to from `tile`.
 * `goal` is passed so ships may enter a harbour tile only as their destination.
 */
function forEachMove(
  world: World,
  player: PlayerId,
  kind: StationKind,
  tile: number,
  goal: number,
  start: number,
  visit: (next: number, cost: number) => void,
): void {
  const grid = world.grid;
  if (kind === 'road' || kind === 'rail') {
    for (const e of world.edgesAt(tile)) {
      if (e.kind !== kind || !edgeUsable(world, e, player)) continue;
      const other = e.a === tile ? e.b : e.a;
      visit(other, stepLength(grid, tile, other));
    }
    if (kind === 'road' && isStreet(world, tile)) {
      for (const d of STRAIGHT_DIRS) {
        const nb = neighbor(grid, tile, d);
        if (nb >= 0 && isStreet(world, nb)) visit(nb, 1);
      }
    }
    // A station connects to the player's road or track right next to it (like a loading bay along the
    // road), so it doesn't have to stand exactly on the end of the road.
    for (let d = 0; d < 8; d++) {
      const nb = neighbor(grid, tile, d);
      if (nb < 0) continue;
      if (tile === start && onNetwork(world, player, kind, nb)) visit(nb, stepLength(grid, tile, nb));
      else if (nb === goal && tile !== start && world.stationAt.get(goal)?.kind === kind) visit(nb, stepLength(grid, tile, nb));
    }
    return;
  }

  // Ships: open water is free for everybody, canals need a usable canal edge.
  for (const e of world.edgesAt(tile)) {
    if (e.kind !== 'canal' || !edgeUsable(world, e, player)) continue;
    const other = e.a === tile ? e.b : e.a;
    visit(other, stepLength(grid, tile, other));
  }
  const fromHarbour = tile === start && !isWater(world, tile);
  if (isWater(world, tile) || fromHarbour) {
    for (let d = 0; d < 8; d++) {
      const nb = neighbor(grid, tile, d);
      if (nb < 0) continue;
      if (isWater(world, nb) || (nb === goal && !fromHarbour)) visit(nb, stepLength(grid, tile, nb));
      else if (fromHarbour && hasUsableCanal(world, player, nb)) visit(nb, stepLength(grid, tile, nb));
    }
  }
  // A canal tile next to the destination harbour may dock there.
  if (!isWater(world, tile) && tile !== start && hasUsableCanal(world, player, tile)) {
    for (let d = 0; d < 8; d++) {
      const nb = neighbor(grid, tile, d);
      if (nb === goal) visit(nb, stepLength(grid, tile, nb));
    }
  }
}

/** Does a vehicle of this kind have a way on or off this tile (a usable road/track, or a city street)? */
export function onNetwork(world: World, player: PlayerId, kind: StationKind, tile: number): boolean {
  if (kind === 'road' && isStreet(world, tile)) return true;
  return world.edgesAt(tile).some((e) => e.kind === kind && edgeUsable(world, e, player));
}

/** Is a (planned) station on this tile connected to the player's network, directly or next to it? */
export function stationLinked(world: World, player: PlayerId, kind: StationKind, tile: number): boolean {
  if (kind === 'water') return true; // harbours always lie at the water
  if (onNetwork(world, player, kind, tile)) return true;
  for (let d = 0; d < 8; d++) {
    const nb = neighbor(world.grid, tile, d);
    if (nb >= 0 && onNetwork(world, player, kind, nb)) return true;
  }
  return false;
}

function hasUsableCanal(world: World, player: PlayerId, tile: number): boolean {
  return world.edgesAt(tile).some((e) => e.kind === 'canal' && edgeUsable(world, e, player));
}

/** A* from one station tile to another. Returns null when the network does not connect them. */
export function findRoute(world: World, player: PlayerId, kind: StationKind, from: number, to: number): Route | null {
  if (from === to) return null;
  const grid = world.grid;
  const gx = tileX(grid, to);
  const gy = tileY(grid, to);
  const g = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const open = new MinHeap();
  open.push(from, 0);
  const closed = new Set<number>();
  while (open.size) {
    const cur = open.pop();
    if (cur === to) break;
    if (closed.has(cur)) continue;
    closed.add(cur);
    const base = g.get(cur)!;
    forEachMove(world, player, kind, cur, to, from, (next, cost) => {
      if (closed.has(next)) return;
      const ng = base + cost;
      if (ng < (g.get(next) ?? Infinity)) {
        g.set(next, ng);
        prev.set(next, cur);
        open.push(next, ng + octile(tileX(grid, next), tileY(grid, next), gx, gy));
      }
    });
  }
  if (!g.has(to)) return null;
  const tiles = [to];
  while (tiles[tiles.length - 1] !== from) tiles.push(prev.get(tiles[tiles.length - 1])!);
  tiles.reverse();
  const cum = [0];
  for (let i = 1; i < tiles.length; i++) cum.push(cum[i - 1] + stepLength(grid, tiles[i - 1], tiles[i]));
  return { tiles, cum, length: cum[cum.length - 1] };
}

/** Position (tile coordinates of the centre) at a distance along a route. */
export function pointOnRoute(world: World, route: Route, distance: number): [number, number] {
  const grid = world.grid;
  const d = Math.max(0, Math.min(route.length, distance));
  let i = 1;
  while (i < route.tiles.length - 1 && route.cum[i] < d) i++;
  const a = route.tiles[i - 1];
  const b = route.tiles[i];
  const seg = route.cum[i] - route.cum[i - 1] || 1;
  const f = Math.max(0, Math.min(1, (d - route.cum[i - 1]) / seg));
  return [tileX(grid, a) + 0.5 + (tileX(grid, b) - tileX(grid, a)) * f, tileY(grid, a) + 0.5 + (tileY(grid, b) - tileY(grid, a)) * f];
}
