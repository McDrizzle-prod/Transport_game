import { describe, expect, it } from 'vitest';
import { CARGO, World, estimateLine, resolveTurn, transferPartners } from '../src';
import type { Action, GameState, OrderSlots } from '../src';
import { addCity, addIndustry, hPath, makeWorld, slots } from './helpers';
import type { TestWorld } from './helpers';

function run(w: TestWorld, state: GameState, orders: Record<string, OrderSlots> = {}) {
  return resolveTurn(w.map, state, orders, 0);
}

/**
 * Oil well (west) and refinery (east) with a lake in between:
 * truck R1 → R2, handed over to harbour H1 (2 tiles from R2), ship H1 → H2, handed over to train station
 * T1 (2 tiles from H2), train T1 → T2 at the refinery.
 */
function oilChain(opts: { ship?: boolean; train?: boolean } = {}) {
  const w = makeWorld({ width: 60, height: 20, water: (x) => x >= 20 && x <= 39, actionSlots: 10, money: 3_000_000 });
  const well = addIndustry(w, 'oil_well', 2, 8, 60, 120);
  const refinery = addIndustry(w, 'refinery', 56, 8);
  const road = hPath(w, 4, 17, 9);
  const rail = hPath(w, 42, 55, 9);
  const h1 = w.at(19, 9);
  const h2 = w.at(40, 9);
  const actions: Action[] = [
    { type: 'build', kind: 'road', path: road, stationStart: true, stationEnd: true },
    { type: 'station', kind: 'water', tile: h1 },
    { type: 'station', kind: 'water', tile: h2 },
    { type: 'build', kind: 'rail', path: rail, stationStart: true, stationEnd: true },
    { type: 'vehicles', model: 'truck', from: road[0], to: road[road.length - 1], count: 3 },
  ];
  if (opts.ship !== false) actions.push({ type: 'vehicles', model: 'cargo_ship', from: h1, to: h2, count: 1 });
  if (opts.train !== false) actions.push({ type: 'vehicles', model: 'train_steam', from: rail[0], to: rail[rail.length - 1], count: 1 });
  return { w, well, refinery, road, rail, h1, h2, orders: { A: slots(...actions) } };
}

describe('transshipment', () => {
  it('carries oil by truck, ship and train to the refinery and splits the revenue by distance', () => {
    const { w, orders } = oilChain();
    let { state } = run(w, w.state, orders);
    const world = new World(w.map, state);
    const lineOf = (model: string) => state.vehicles.find((v) => v.model === model)!.lineId;
    const [truck, ship, train] = [lineOf('truck'), lineOf('cargo_ship'), lineOf('train_steam')];
    // The loading point by the lake lies within reach of the harbour.
    const r2 = world.stationAt.get(w.at(17, 9))!;
    expect(transferPartners(world, r2, 'A').map((s) => s.kind)).toEqual(['water']);

    let delivered = 0;
    let last = run(w, state);
    for (let i = 0; i < 5; i++) {
      last = run(w, state);
      state = last.state;
      delivered += last.report.deliveries.filter((d) => d.lineId === train).reduce((s, d) => s + d.amount, 0);
    }
    expect(delivered).toBeGreaterThan(0);
    expect(state.industries.find((i) => i.type === 'refinery')!.stats.received.crude_oil).toBeGreaterThan(0);

    const rows = last.report.deliveries;
    const row = (line: number) => rows.find((d) => d.lineId === line && d.cargo === 'crude_oil')!;
    // Truck and ship hand the oil over, the train delivers it.
    expect(row(truck).transferred).toBeGreaterThan(0);
    expect(row(ship).transferred).toBeGreaterThan(0);
    expect(row(train).amount).toBeGreaterThan(0);
    // Every leg earns its part when the oil arrives: truck 13 tiles, ship 21, train 13.
    expect(row(truck).revenue).toBeGreaterThan(0);
    expect(row(ship).revenue / row(train).revenue).toBeCloseTo(21 / 13, 1);
    expect(row(truck).revenue / row(train).revenue).toBeCloseTo(1, 1);
    // Together they earn what one vehicle would get for the whole distance (oil well → refinery: 54 tiles).
    const total = row(truck).revenue + row(ship).revenue + row(train).revenue;
    const price = CARGO.crude_oil.price * (state.market.history.crude_oil?.at(-2) ?? 1);
    expect(total / (row(train).amount * 54 * price)).toBeGreaterThan(0.8);
    expect(total / (row(train).amount * 54 * price)).toBeLessThan(1.25);
    // Replay: the hand-overs show up as events without revenue.
    expect(last.report.replay.events.some((e) => e.transfer && e.cargo === 'crude_oil' && e.revenue === 0)).toBe(true);
  });

  it('only loads oil on the truck when a line takes it further from the harbour', () => {
    const { w, orders } = oilChain({ ship: false });
    let { state } = run(w, w.state, orders);
    for (let i = 0; i < 2; i++) state = run(w, state).state;
    // Without the ship nobody wants the oil at the lake: the trucks don't take it and nothing is lost.
    const truckLine = state.vehicles.find((v) => v.model === 'truck')!.lineId;
    const line = state.lines.find((l) => l.id === truckLine)!;
    expect(line.stats.transferred?.crude_oil ?? 0).toBe(0);
    expect(state.stations.every((s) => s.waiting.every((l) => !l.legs))).toBe(true);
  });

  it('keeps handed-over cargo waiting at the harbour until a ship can take it on', () => {
    const { w, orders } = oilChain({ train: false });
    let { state } = run(w, w.state, orders);
    for (let i = 0; i < 2; i++) state = run(w, state).state;
    // Without the train there is no way on from the far harbour, so the ship has nothing to take and the
    // trucks have nothing to bring.
    const harbour = state.stations.find((s) => s.tile === w.at(19, 9))!;
    expect(harbour.waiting.length).toBe(0);
    expect(state.lines.every((l) => !l.stats.transferred)).toBe(true);
  });

  it('never sends cargo back to a station it came from', () => {
    // One loading point serves an oil well and a refinery; trucks bring fuel to a city. Crude oil must not be
    // carried to the city only to come back.
    const w = makeWorld({ width: 30, height: 12 });
    addIndustry(w, 'oil_well', 2, 4, 60, 120);
    addIndustry(w, 'refinery', 5, 4);
    addCity(w, 20, 5, { fuel: 40 });
    const road = hPath(w, 4, 18, 6);
    let { state } = run(w, w.state, {
      A: slots(
        { type: 'build', kind: 'road', path: road, stationStart: true, stationEnd: true },
        { type: 'vehicles', model: 'truck', from: road[0], to: road[road.length - 1], count: 2 },
      ),
    });
    for (let i = 0; i < 3; i++) state = run(w, state).state;
    const cityStation = state.stations.find((st) => st.tile === road[road.length - 1])!;
    expect(cityStation.waiting).toEqual([]);
    expect(state.lines[0].stats.transferred).toBeUndefined();
    expect(state.vehicles.every((v) => v.cargo.every((l) => l.cargo !== 'crude_oil'))).toBe(true);
  });

  it('estimates the transshipment for the feeder and the onward lines', () => {
    const { w, orders, road, h1, h2, rail } = oilChain();
    const { state } = run(w, w.state, orders);
    const world = new World(w.map, state);
    const truck = estimateLine(world, 'A', 'truck', road[0], road[road.length - 1], 3)!;
    const oil = truck.flows.find((f) => f.cargo === 'crude_oil')!;
    expect(oil.consumer.name).toContain('Raffinaderij');
    expect(oil.via).toEqual([expect.stringContaining('Haven'), expect.stringContaining('Station')]);
    expect(oil.share).toBeCloseTo(13 / 47, 2);
    expect(oil.revenuePerTurn).toBeGreaterThan(0);

    const ship = estimateLine(world, 'A', 'cargo_ship', h1, h2, 1)!;
    const carried = ship.flows.find((f) => f.cargo === 'crude_oil')!;
    expect(carried.inbound).toBe(true);
    expect(carried.supplyPerTurn).toBeGreaterThan(0);
    expect(carried.share).toBeCloseTo(21 / 47, 2);

    const train = estimateLine(world, 'A', 'train_steam', rail[0], rail[rail.length - 1], 1)!;
    expect(train.flows.find((f) => f.cargo === 'crude_oil')?.inbound).toBe(true);
  });
});
