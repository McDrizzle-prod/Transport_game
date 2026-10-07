import { describe, expect, it } from 'vitest';
import { CARGO, TICKS_PER_TURN, VEHICLES, World, estimateLine, resolveTurn } from '../src';
import type { GameState, OrderSlots } from '../src';
import { addCity, addIndustry, hPath, makeWorld, slots } from './helpers';
import type { TestWorld } from './helpers';

function run(w: TestWorld, state: GameState, orders: Record<string, OrderSlots> = {}) {
  return resolveTurn(w.map, state, orders, 0);
}

/** Farm (west) and food plant (east) 22 tiles apart, connected by a road with truck stations next to them. */
function farmToFoodPlant() {
  const w = makeWorld({ width: 32, height: 12 });
  const farm = addIndustry(w, 'farm', 2, 4, 60, 60);
  const plant = addIndustry(w, 'food_plant', 24, 4);
  const path = hPath(w, 4, 23, 5);
  const orders = {
    A: slots(
      { type: 'build', kind: 'road', path, stationStart: true, stationEnd: true },
      { type: 'vehicles', model: 'truck', from: path[0], to: path[path.length - 1], count: 2 },
    ),
  };
  return { w, farm, plant, path, orders };
}

describe('economy', () => {
  it('earns money when goods are delivered between two industries, based on distance', () => {
    const { w, orders } = farmToFoodPlant();
    const { state, report } = run(w, w.state, orders);

    const grain = report.deliveries.filter((d) => d.cargo === 'grain');
    expect(grain.length).toBe(1);
    expect(grain[0].amount).toBeGreaterThan(0);
    // Revenue = amount × base price × market price (1.0) × distance between the industry centres (22).
    expect(grain[0].revenue).toBeCloseTo(grain[0].amount * CARGO.grain.price * 22, -1);
    expect(report.finances.A.revenue).toBe(grain[0].revenue);
    const plant = state.industries.find((i) => i.type === 'food_plant')!;
    expect(plant.stats.received.grain).toBe(grain[0].amount);
    // The food plant processes what it received.
    expect(plant.stats.produced).toBeGreaterThan(0);
  });

  it('keeps vehicles moving across turns and charges upkeep', () => {
    const { w, orders } = farmToFoodPlant();
    const t1 = run(w, w.state, orders);
    const t2 = run(w, t1.state);
    expect(t2.report.finances.A.revenue).toBeGreaterThan(0);
    expect(t2.report.finances.A.upkeep).toBeGreaterThanOrEqual(2 * VEHICLES.truck.upkeep);
    expect(t2.state.turn).toBe(3);
    // Replay frames: one position per tick plus the start position.
    expect(t2.report.replay.vehicles[0].frames).toHaveLength((TICKS_PER_TURN + 1) * 2);
  });

  it('carries goods both ways when both ends supply something the other accepts', () => {
    const w = makeWorld({ width: 40, height: 12 });
    addIndustry(w, 'farm', 2, 4, 60, 60);
    addCity(w, 30, 5, { food: 50 });
    addIndustry(w, 'food_plant', 15, 4); // in the middle
    const westPath = hPath(w, 4, 14, 5);
    const eastPath = hPath(w, 17, 28, 5);
    const orders = {
      A: slots(
        { type: 'build', kind: 'road', path: westPath, stationStart: true, stationEnd: true },
        { type: 'build', kind: 'road', path: eastPath, stationStart: true, stationEnd: true },
        { type: 'vehicles', model: 'truck', from: westPath[0], to: westPath[westPath.length - 1], count: 2 },
        { type: 'vehicles', model: 'truck', from: eastPath[0], to: eastPath[eastPath.length - 1], count: 2 },
      ),
    };
    let { state } = run(w, w.state, orders);
    for (let i = 0; i < 2; i++) state = run(w, state).state;
    const last = run(w, state);
    const cargos = new Set(last.report.deliveries.map((d) => d.cargo));
    // Production chain: grain to the food plant, food from the plant to the city.
    expect(cargos.has('grain')).toBe(true);
    expect(cargos.has('food')).toBe(true);
    expect(last.state.cityStats['1']?.food).toBeGreaterThan(0);
  });

  it('only pays a ship once it arrives, which can take more than a turn', () => {
    // A long canal-free waterway: water from x=5 to x=55 on rows 4..6.
    const w = makeWorld({ width: 62, height: 12, water: (x, y) => x >= 5 && x <= 55 && y >= 4 && y <= 6, money: 2_000_000 });
    addIndustry(w, 'coal_mine', 1, 4, 80, 80);
    addIndustry(w, 'steel_mill', 58, 4);
    const west = w.at(4, 5);
    const east = w.at(56, 5);
    const orders = {
      A: slots(
        { type: 'station', kind: 'water', tile: west },
        { type: 'station', kind: 'water', tile: east },
        { type: 'vehicles', model: 'barge', from: west, to: east, count: 1 },
      ),
    };
    const t1 = run(w, w.state, orders);
    expect(t1.report.slots[2].outcome).toBe('ok');
    const t2 = run(w, t1.state);
    const t3 = run(w, t2.state);
    const revenues = [t1, t2, t3].map((t) => t.report.finances.A.revenue);
    // ~51 tiles at 22 tiles/turn: the first delivery happens during turn 3.
    expect(revenues[0]).toBe(0);
    expect(revenues[1]).toBe(0);
    expect(revenues[2]).toBeGreaterThan(0);
  });

  it('lowers the price of a cargo that is delivered a lot', () => {
    const { w, path } = farmToFoodPlant();
    w.state.industries[0].rate = 80;
    const orders = {
      A: slots(
        { type: 'build', kind: 'road', path, stationStart: true, stationEnd: true },
        { type: 'vehicles', model: 'truck', from: path[0], to: path[path.length - 1], count: 5 },
      ),
    };
    let { state } = run(w, w.state, orders);
    for (let i = 0; i < 6; i++) state = run(w, state).state;
    // ~80 of the 120 grain the food plant can use is delivered every turn: the price drops.
    // Coal is wanted by nobody here and stays at its start price; passengers have a fixed price.
    expect(state.market.history.grain.length).toBeGreaterThan(5);
    expect(state.market.supply.grain).toBeGreaterThan(60);
    expect(state.market.prices.grain).toBeLessThan(0.95);
    expect(state.market.prices.coal).toBe(1);
    expect(state.market.prices.passengers).toBe(1);
  });

  it('estimates the earnings of a line before buying vehicles', () => {
    const { w, path } = farmToFoodPlant();
    const built = run(w, w.state, { A: slots({ type: 'build', kind: 'road', path, stationStart: true, stationEnd: true }) });
    const world = new World(w.map, built.state);
    const est = estimateLine(world, 'A', 'truck', path[0], path[path.length - 1], 2)!;
    expect(est.connected).toBe(true);
    expect(est.length).toBe(19);
    expect(est.flows.some((f) => f.cargo === 'grain' && f.direction === 0)).toBe(true);
    expect(est.revenuePerTurn).toBeGreaterThan(0);
    expect(est.firstDeliveryTurns).toBeLessThan(1);
  });
});
