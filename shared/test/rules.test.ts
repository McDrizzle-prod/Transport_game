import { describe, expect, it } from 'vitest';
import { STATIONS, TRANSPORT, VEHICLES, World, edgeKey, planRoute, previewOrders, resolveTurn, sanitizeOrders } from '../src';
import { addIndustry, hPath, makeWorld, slots, vPath } from './helpers';

describe('building routes', () => {
  it('builds a road with stations at both ends and charges the player', () => {
    const w = makeWorld({ width: 30, height: 12 });
    const path = hPath(w, 3, 13, 5);
    const { state, report } = resolveTurn(w.map, w.state, { A: slots({ type: 'build', kind: 'road', path, stationStart: true, stationEnd: true }) }, 0);

    const result = report.slots.find((r) => r.player === 'A')!;
    expect(result.outcome).toBe('ok');
    expect(result.built).toHaveLength(10);
    expect(result.stations).toHaveLength(2);
    const expectedCost = 10 * TRANSPORT.road.edgeCost + 2 * STATIONS.road.cost;
    expect(result.cost).toBe(expectedCost);
    expect(state.players.find((p) => p.id === 'A')!.last!.construction).toBe(expectedCost);
    expect(state.stations.map((s) => s.tile).sort()).toEqual([w.at(3, 5), w.at(13, 5)].sort());
    for (const t of path) expect(state.infra.tiles[t].owners).toEqual(['A']);
  });

  it('gives a contested tile to the lower slot; the later route is built partially', () => {
    const w = makeWorld({ width: 30, height: 20 });
    const a = hPath(w, 2, 20, 8); // A: horizontal, slot 3
    const b = vPath(w, 10, 2, 16); // B: vertical, slot 1 -> crosses A at (10, 8)
    const { state, report } = resolveTurn(
      w.map,
      w.state,
      {
        A: slots(null, null, { type: 'build', kind: 'rail', path: a }),
        B: slots({ type: 'build', kind: 'rail', path: b }),
      },
      0,
    );
    const crossing = w.at(10, 8);
    expect(state.infra.tiles[crossing].owners).toEqual(['B']);

    const ra = report.slots.find((r) => r.player === 'A')!;
    const rb = report.slots.find((r) => r.player === 'B')!;
    expect(rb.outcome).toBe('ok');
    expect(ra.outcome).toBe('partial');
    expect(ra.lost).toEqual([{ tile: crossing, owners: ['B'], turn: 1, slot: 1 }]);
    // A builds everything except the two segments touching the lost tile.
    expect(ra.built).toHaveLength(a.length - 1 - 2);
    expect(state.infra.edges[edgeKey('rail', w.at(9, 8), crossing)]).toBeUndefined();
    expect(ra.cost).toBe((a.length - 3) * TRANSPORT.rail.edgeCost);
  });

  it('shares a tile when both players build there in the same slot', () => {
    const w = makeWorld({ width: 30, height: 20 });
    const a = hPath(w, 2, 20, 8);
    const b = vPath(w, 10, 2, 16);
    const { state, report } = resolveTurn(
      w.map,
      w.state,
      {
        A: slots(null, { type: 'build', kind: 'road', path: a }),
        B: slots(null, { type: 'build', kind: 'road', path: b }),
      },
      0,
    );
    const crossing = w.at(10, 8);
    expect(state.infra.tiles[crossing].owners).toEqual(['A', 'B']);
    const ra = report.slots.find((r) => r.player === 'A')!;
    expect(ra.outcome).toBe('ok');
    expect(ra.shared).toEqual([{ tile: crossing, with: ['B'] }]);
    // Both players keep their own segments through the shared tile.
    expect(state.infra.edges[edgeKey('road', w.at(9, 8), crossing)].owners).toEqual(['A']);
    expect(state.infra.edges[edgeKey('road', w.at(10, 7), crossing)].owners).toEqual(['B']);
  });

  it('shares identical segments built in the same slot', () => {
    const w = makeWorld({ width: 30, height: 12 });
    const path = hPath(w, 2, 12, 5);
    const { state } = resolveTurn(
      w.map,
      w.state,
      { A: slots({ type: 'build', kind: 'rail', path }), B: slots({ type: 'build', kind: 'rail', path }) },
      0,
    );
    expect(state.infra.edges[edgeKey('rail', w.at(2, 5), w.at(3, 5))].owners).toEqual(['A', 'B']);
  });

  it('refuses two different stations on one tile in the same slot, shares the same type', () => {
    const w = makeWorld({ width: 20, height: 12 });
    const tile = w.at(6, 6);
    const mixed = resolveTurn(
      w.map,
      w.state,
      { A: slots({ type: 'station', kind: 'road', tile }), B: slots({ type: 'station', kind: 'rail', tile }) },
      0,
    );
    expect(mixed.state.stations).toHaveLength(0);
    expect(mixed.state.infra.tiles[tile]).toBeUndefined();
    expect(mixed.report.slots.every((r) => r.outcome === 'failed')).toBe(true);

    const same = resolveTurn(
      w.map,
      w.state,
      { A: slots({ type: 'station', kind: 'road', tile }), B: slots({ type: 'station', kind: 'road', tile }) },
      0,
    );
    expect(same.state.stations).toHaveLength(1);
    expect(same.state.stations[0].owners).toEqual(['A', 'B']);
  });

  it('rejects building over another player and blocks crossing diagonals', () => {
    const w = makeWorld({ width: 20, height: 20 });
    const first = resolveTurn(w.map, w.state, { A: slots({ type: 'build', kind: 'road', path: [w.at(5, 5), w.at(6, 6)] }) }, 0);
    const second = resolveTurn(w.map, first.state, { B: slots({ type: 'build', kind: 'road', path: [w.at(6, 5), w.at(5, 6)] }) }, 0);
    const rb = second.report.slots[0];
    expect(rb.built).toHaveLength(0);
    expect(rb.outcome).toBe('failed');
  });

  it('fails an action the player cannot afford without claiming anything', () => {
    const w = makeWorld({ width: 40, height: 12, money: 50_000 });
    const path = hPath(w, 2, 30, 5);
    const { state, report } = resolveTurn(w.map, w.state, { A: slots({ type: 'build', kind: 'rail', path }) }, 0);
    expect(report.slots[0].outcome).toBe('failed');
    expect(report.slots[0].messages[0].code).toBe('insufficient_funds');
    expect(Object.keys(state.infra.tiles)).toHaveLength(0);
  });

  it('executes a player own slots in order (vehicles need the route from an earlier slot)', () => {
    const w = makeWorld({ width: 30, height: 12 });
    const path = hPath(w, 3, 13, 5);
    const build = { type: 'build', kind: 'road', path, stationStart: true, stationEnd: true } as const;
    const buy = { type: 'vehicles', model: 'truck', from: path[0], to: path[path.length - 1], count: 2 } as const;

    const wrongOrder = resolveTurn(w.map, w.state, { A: slots(buy, build) }, 0);
    expect(wrongOrder.report.slots[0].outcome).toBe('failed');
    expect(wrongOrder.report.slots[0].messages[0].code).toBe('station_missing');
    expect(wrongOrder.state.vehicles).toHaveLength(0);

    const rightOrder = resolveTurn(w.map, w.state, { A: slots(build, buy) }, 0);
    expect(rightOrder.report.slots[1].outcome).toBe('ok');
    expect(rightOrder.state.vehicles).toHaveLength(2);
    expect(rightOrder.state.lines).toHaveLength(1);
    expect(rightOrder.report.finances.A.vehicles).toBe(2 * VEHICLES.truck.price);
  });

  it('only lets vehicles drive over the owner network', () => {
    const w = makeWorld({ width: 30, height: 12 });
    const path = hPath(w, 3, 13, 5);
    const first = resolveTurn(w.map, w.state, { A: slots({ type: 'build', kind: 'road', path, stationStart: true, stationEnd: true }) }, 0);
    // B builds its own stations next to A's road but has no road of its own.
    const second = resolveTurn(
      w.map,
      first.state,
      {
        B: slots(
          { type: 'station', kind: 'road', tile: w.at(3, 6) },
          { type: 'station', kind: 'road', tile: w.at(13, 6) },
          { type: 'vehicles', model: 'truck', from: w.at(3, 6), to: w.at(13, 6), count: 1 },
        ),
      },
      0,
    );
    expect(second.report.slots[2].messages[0].code).toBe('not_connected');
  });
});

describe('planning and previews', () => {
  it('plans a route around tiles of other players and reuses the own network for free', () => {
    const w = makeWorld({ width: 30, height: 20 });
    const wall = vPath(w, 10, 0, 14);
    const first = resolveTurn(w.map, w.state, { B: slots({ type: 'build', kind: 'road', path: wall }) }, 0);
    const world = new World(w.map, first.state);
    const plan = planRoute(world, 'A', 'road', [w.at(5, 8), w.at(15, 8)]);
    expect(plan.path).not.toBeNull();
    for (const t of plan.path!) expect(wall.includes(t)).toBe(false);
    expect(plan.path!.some((t) => Math.floor(t / 30) >= 15)).toBe(true);

    const own = planRoute(world, 'B', 'road', [w.at(10, 2), w.at(10, 12)]);
    expect(own.plan!.cost).toBe(0);
  });

  it('previews the result of the own slots including costs', () => {
    const w = makeWorld({ width: 30, height: 12 });
    const path = hPath(w, 3, 13, 5);
    const preview = previewOrders(
      w.map,
      w.state,
      'A',
      slots(
        { type: 'build', kind: 'road', path, stationStart: true, stationEnd: true },
        { type: 'vehicles', model: 'truck', from: path[0], to: path[path.length - 1], count: 1 },
      ),
    );
    expect(preview.results[0]!.outcome).toBe('ok');
    expect(preview.results[1]!.outcome).toBe('ok');
    expect(preview.world.state.vehicles).toHaveLength(1);
    // The original state is untouched.
    expect(w.state.vehicles).toHaveLength(0);
  });
});

describe('order validation', () => {
  it('accepts valid orders and rejects malformed ones', () => {
    const w = makeWorld({ width: 20, height: 20 });
    const good = sanitizeOrders(w.map, [{ type: 'build', kind: 'road', path: [w.at(1, 1), w.at(2, 2), w.at(3, 2)] }, null]);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.slots).toHaveLength(5);

    expect(sanitizeOrders(w.map, [{ type: 'build', kind: 'road', path: [w.at(1, 1), w.at(5, 5)] }]).ok).toBe(false);
    expect(sanitizeOrders(w.map, [{ type: 'build', kind: 'teleport', path: [1, 2] }]).ok).toBe(false);
    expect(sanitizeOrders(w.map, [{ type: 'vehicles', model: 'truck', from: 1, to: 2, count: 99 }]).ok).toBe(false);
    expect(sanitizeOrders(w.map, [null, null, null, null, null, null]).ok).toBe(false);
    expect(sanitizeOrders(w.map, 'nonsense').ok).toBe(false);
  });
});

describe('industries in the way', () => {
  it('refuses routes through industries', () => {
    const w = makeWorld({ width: 20, height: 12 });
    addIndustry(w, 'farm', 8, 4);
    const { report } = resolveTurn(w.map, w.state, { A: slots({ type: 'build', kind: 'road', path: hPath(w, 2, 14, 5) }) }, 0);
    expect(report.slots[0].outcome).toBe('failed');
    expect(report.slots[0].messages[0].code).toBe('path_blocked');
  });
});
