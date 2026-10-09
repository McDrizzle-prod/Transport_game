import { describe, expect, it } from 'vitest';
import { World, addRoutePoint, findRoute, resolveTurn, stationLinked, straightLine } from '../src';
import type { TransportKind } from '../src';
import { addIndustry, hPath, makeWorld, slots } from './helpers';

/** Taps the given points one after another, like the route tool does. */
function tap(world: World, kind: TransportKind, points: number[]): number[] {
  let path: number[] = [];
  for (const t of points) {
    const r = addRoutePoint(world, 'A', kind, path, t);
    if (!r.ok) throw new Error(r.error);
    path = r.path;
  }
  return path;
}

describe('route tool', () => {
  it('connects two points with a straight line, with as few segments as possible', () => {
    const w = makeWorld({ width: 30, height: 20 });
    expect(straightLine(w.map, w.at(2, 2), w.at(8, 5))).toHaveLength(7);
    const world = new World(w.map, w.state);
    expect(tap(world, 'road', [w.at(2, 2), w.at(8, 2)])).toEqual(hPath(w, 2, 8, 2));
    // Diagonal steps count as one segment each.
    expect(tap(world, 'road', [w.at(2, 2), w.at(6, 6)])).toHaveLength(5);
  });

  it('runs exactly through every tapped point', () => {
    const w = makeWorld({ width: 30, height: 20 });
    const world = new World(w.map, w.state);
    const path = tap(world, 'rail', [w.at(2, 2), w.at(6, 2), w.at(6, 6)]);
    expect(path).toEqual([...hPath(w, 2, 6, 2), w.at(6, 3), w.at(6, 4), w.at(6, 5), w.at(6, 6)]);
  });

  it('goes around an obstacle, refuses one as a point and may not cross itself', () => {
    const w = makeWorld({ width: 30, height: 20 });
    addIndustry(w, 'farm', 5, 4);
    const world = new World(w.map, w.state);
    const start = [w.at(2, 5)];
    const around = addRoutePoint(world, 'A', 'rail', start, w.at(9, 5));
    expect(around.ok && around.detour).toBe(true);
    if (around.ok) {
      expect(around.path[around.path.length - 1]).toBe(w.at(9, 5));
      expect(around.path.every((t) => w.map.use[t] === 0)).toBe(true);
    }
    expect(addRoutePoint(world, 'A', 'rail', start, w.at(5, 5))).toEqual({ ok: false, error: 'blocked' });
    const loop = tap(world, 'road', [w.at(10, 10), w.at(14, 10), w.at(14, 12)]);
    expect(addRoutePoint(world, 'A', 'road', loop, w.at(12, 8))).toEqual({ ok: false, error: 'crossing' });
  });
});

describe('stations next to a road', () => {
  it('are connected to it, so vehicles can drive', () => {
    const w = makeWorld({ width: 30, height: 12 });
    const road = hPath(w, 5, 15, 5);
    // Stations one tile beside both ends of the road, not on it.
    const a = w.at(4, 6);
    const b = w.at(16, 4);
    const { state, report } = resolveTurn(
      w.map,
      w.state,
      {
        A: slots(
          { type: 'build', kind: 'road', path: road },
          { type: 'station', kind: 'road', tile: a },
          { type: 'station', kind: 'road', tile: b },
          { type: 'vehicles', model: 'truck', from: a, to: b, count: 1 },
        ),
      },
      0,
    );
    expect(report.slots[3].outcome).toBe('ok');
    const world = new World(w.map, state);
    expect(findRoute(world, 'A', 'road', a, b)?.length).toBeGreaterThan(10);
    expect(stationLinked(world, 'A', 'road', a)).toBe(true);
    // Two tiles away is too far; another player's road doesn't count.
    expect(stationLinked(world, 'A', 'road', w.at(5, 7))).toBe(false);
    expect(stationLinked(world, 'B', 'road', a)).toBe(false);
  });
});
