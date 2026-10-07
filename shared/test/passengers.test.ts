import { describe, expect, it } from 'vitest';
import { CARGO, HQ_BONUS, STATIONS, World, coverageAt, estimateLine, resolveTurn } from '../src';
import type { GameState, OrderSlots } from '../src';
import { addCity, addIndustry, hPath, makeWorld, slots } from './helpers';
import type { TestWorld } from './helpers';

function run(w: TestWorld, state: GameState, orders: Record<string, OrderSlots> = {}) {
  return resolveTurn(w.map, state, orders, 0);
}

function runTurns(w: TestWorld, orders: Record<string, OrderSlots>, turns: number) {
  let outcome = run(w, w.state, orders);
  for (let i = 1; i < turns; i++) outcome = run(w, outcome.state);
  return outcome;
}

/** Two cities 22 tiles apart with a road and stations right next to them. */
function twoCities() {
  const w = makeWorld({ width: 32, height: 12 });
  const west = addCity(w, 4, 5, { food: 30 });
  const east = addCity(w, 26, 5, { goods: 30 });
  const path = hPath(w, 6, 24, 5);
  const build = { type: 'build', kind: 'road', path, stationStart: true, stationEnd: true } as const;
  return { w, west, east, path, build };
}

describe('catchment area', () => {
  it('is small: a station two tiles away does not serve an industry', () => {
    const w = makeWorld({ width: 20, height: 12 });
    const farm = addIndustry(w, 'farm', 5, 5);
    const world = new World(w.map, w.state);
    expect(STATIONS.road.radius).toBe(1);
    expect(coverageAt(world, 'road', w.at(7, 5)).industries).toEqual([farm]);
    expect(coverageAt(world, 'road', w.at(8, 5)).industries).toEqual([]);
    expect(coverageAt(world, 'rail', w.at(4, 7)).industries).toEqual([farm]);
    expect(coverageAt(world, 'rail', w.at(3, 7)).industries).toEqual([]);
  });
});

describe('passengers', () => {
  it('travel by bus between two cities, both ways, paid by the distance between the cities', () => {
    const { w, path, build } = twoCities();
    const { state, report } = runTurns(
      w,
      { A: slots(build, { type: 'vehicles', model: 'bus', from: path[0], to: path[path.length - 1], count: 2 }) },
      3,
    );
    const trips = report.deliveries.filter((d) => d.cargo === 'passengers');
    expect(trips.length).toBe(1);
    const d = trips[0];
    expect(d.amount).toBeGreaterThan(0);
    expect(d.revenue).toBeCloseTo(d.amount * CARGO.passengers.price * 22, -1);
    // Both cities received passengers.
    expect(state.cityStats['1']?.passengers).toBeGreaterThan(0);
    expect(state.cityStats['2']?.passengers).toBeGreaterThan(0);
    expect(state.lines[0].carries).toBe('passengers');
  });

  it('are not carried by trucks, and buses carry no freight', () => {
    const { w, path, build } = twoCities();
    const trucks = runTurns(w, { A: slots(build, { type: 'vehicles', model: 'truck', from: path[0], to: path[path.length - 1], count: 2 }) }, 3);
    expect(trucks.report.deliveries).toHaveLength(0);

    const f = makeWorld({ width: 32, height: 12 });
    addIndustry(f, 'farm', 2, 4, 60, 60);
    addIndustry(f, 'food_plant', 24, 4);
    const road = hPath(f, 4, 23, 5);
    const buses = runTurns(
      f,
      {
        A: slots(
          { type: 'build', kind: 'road', path: road, stationStart: true, stationEnd: true },
          { type: 'vehicles', model: 'bus', from: road[0], to: road[road.length - 1], count: 2 },
        ),
      },
      2,
    );
    expect(buses.report.deliveries).toHaveLength(0);
  });

  it('a city keeps a limited number of passengers waiting', () => {
    const { w } = twoCities();
    const { state } = runTurns(w, {}, 6);
    // 1000 inhabitants: 25 passengers per turn, at most 3 turns waiting.
    expect(state.cityStock['1']).toBe(75);
  });

  it('can be estimated before buying buses', () => {
    const { w, path, build } = twoCities();
    const built = run(w, w.state, { A: slots(build) });
    const est = estimateLine(new World(w.map, built.state), 'A', 'bus', path[0], path[path.length - 1], 2)!;
    expect(est.flows.map((f) => [f.cargo, f.direction])).toEqual([
      ['passengers', 0],
      ['passengers', 1],
    ]);
    expect(est.revenuePerTurn).toBeGreaterThan(0);
  });
});

describe('headquarters bonus', () => {
  function farmLine(hq: [number, number]) {
    const w = makeWorld({ width: 32, height: 12 });
    addIndustry(w, 'farm', 2, 4, 60, 60);
    addIndustry(w, 'food_plant', 24, 4);
    w.state.players[0].hq = w.at(...hq);
    const path = hPath(w, 4, 23, 5);
    const orders = {
      A: slots(
        { type: 'build', kind: 'road', path, stationStart: true, stationEnd: true },
        { type: 'vehicles', model: 'truck', from: path[0], to: path[path.length - 1], count: 2 },
      ),
    };
    return { w, path, outcome: runTurns(w, orders, 2) };
  }

  it('adds 25% to deliveries between two stations near the own headquarters', () => {
    // Stations at (4, 5) and (23, 5): an HQ at (13, 9) is within 10 tiles of both, one at (30, 11) is not.
    const near = farmLine([13, 9]).outcome.report;
    const away = farmLine([30, 11]).outcome.report;
    const grain = (r: typeof near) => r.deliveries.find((d) => d.cargo === 'grain')!;
    expect(grain(near).bonus).toBeGreaterThan(0);
    expect(grain(away).bonus).toBe(0);
    expect(grain(near).amount).toBe(grain(away).amount);
    expect(grain(near).revenue).toBeCloseTo(grain(away).revenue * (1 + HQ_BONUS.bonus), -1);
  });

  it('is shown in the estimate', () => {
    const { w, path, outcome } = farmLine([13, 9]);
    const est = estimateLine(new World(w.map, outcome.state), 'A', 'truck', path[0], path[path.length - 1], 1)!;
    expect(est.hqBonus).toBe(true);
    const estB = estimateLine(new World(w.map, outcome.state), 'B', 'truck', path[0], path[path.length - 1], 1)!;
    expect(estB.hqBonus).toBe(false);
  });
});
