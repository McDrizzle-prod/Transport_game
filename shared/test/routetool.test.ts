import { describe, expect, it } from 'vitest';
import { World, extendRoutePath, findRoute, resolveTurn, stationLinked, straightLine } from '../src';
import type { TransportKind } from '../src';
import { addIndustry, hPath, makeWorld, slots } from './helpers';

/** Follows the pointer over the given tiles like the route tool does. */
function draw(world: World, kind: TransportKind, tiles: number[]): number[] {
  let path: number[] = [];
  for (const t of tiles) path = extendRoutePath(world, 'A', kind, path, t);
  return path;
}

describe('route tool', () => {
  it('draws a straight line between two taps, with as few segments as possible', () => {
    const w = makeWorld({ width: 30, height: 20 });
    expect(straightLine(w.map, w.at(2, 2), w.at(8, 5))).toHaveLength(7);
    const world = new World(w.map, w.state);
    const path = draw(world, 'road', [w.at(2, 2), w.at(8, 2)]);
    expect(path).toEqual(hPath(w, 2, 8, 2));
  });

  it('follows the pointer, cuts L-shaped corners and takes back what the pointer goes back over', () => {
    const w = makeWorld({ width: 30, height: 20 });
    const world = new World(w.map, w.state);
    // Right, right, then down: the corner (4, 2) becomes a diagonal step.
    const path = draw(world, 'road', [w.at(2, 2), w.at(3, 2), w.at(4, 2), w.at(4, 3), w.at(4, 4)]);
    expect(path).toEqual([w.at(2, 2), w.at(3, 2), w.at(4, 3), w.at(4, 4)]);
    // Going back over the route removes the end again.
    expect(extendRoutePath(world, 'A', 'road', path, w.at(3, 2))).toEqual([w.at(2, 2), w.at(3, 2)]);
  });

  it('goes around an obstacle and stops at one it can not pass', () => {
    const w = makeWorld({ width: 30, height: 20 });
    addIndustry(w, 'farm', 5, 4);
    const world = new World(w.map, w.state);
    const around = draw(world, 'rail', [w.at(2, 5), w.at(9, 5)]);
    expect(around[0]).toBe(w.at(2, 5));
    expect(around[around.length - 1]).toBe(w.at(9, 5));
    expect(around.every((t) => w.map.use[t] === 0)).toBe(true);
    // The pointer on the industry itself: the route stays where it was.
    const start = draw(world, 'rail', [w.at(2, 5)]);
    expect(extendRoutePath(world, 'A', 'rail', start, w.at(5, 5))).toBe(start);
  });

  it('keeps a bend that joins the existing network', () => {
    const w = makeWorld({ width: 30, height: 20 });
    const built = resolveTurn(w.map, w.state, { A: slots({ type: 'build', kind: 'road', path: [w.at(4, 2), w.at(4, 1)] }) }, 0);
    const world = new World(w.map, built.state);
    const path = draw(world, 'road', [w.at(2, 2), w.at(3, 2), w.at(4, 2), w.at(4, 3)]);
    expect(path).toContain(w.at(4, 2));
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
