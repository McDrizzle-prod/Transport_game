// Station catchment areas, cargo acceptance, revenue and estimates for the UI.
import { CARGO, INDUSTRIES, LOAD_TICKS, STATIONS, TICKS_PER_TURN, VEHICLES } from './config';
import { distToRect, euclid, tileX, tileY } from './geometry';
import { findRoute } from './pathfind';
import type { CargoId, City, Industry, PlayerId, Station, StationKind, VehicleModelId } from './types';
import type { World } from './world';

export interface Coverage {
  industries: Industry[];
  cities: City[];
  /** Cargo produced by covered industries. */
  supplies: Set<CargoId>;
  /** Cargo wanted by covered industries or cities. */
  accepts: Set<CargoId>;
}

export function industryCenter(ind: Industry): [number, number] {
  return [ind.x + ind.w / 2, ind.y + ind.h / 2];
}

export function coversIndustry(kind: StationKind, tile: number, width: number, ind: Industry): boolean {
  const x = tile % width;
  const y = Math.floor(tile / width);
  return distToRect(x, y, ind.x, ind.y, ind.w, ind.h) <= STATIONS[kind].radius;
}

export function coverageAt(world: World, kind: StationKind, tile: number): Coverage {
  const grid = world.grid;
  const x = tileX(grid, tile);
  const y = tileY(grid, tile);
  const radius = STATIONS[kind].radius;
  const industries = world.state.industries.filter((ind) => distToRect(x, y, ind.x, ind.y, ind.w, ind.h) <= radius);
  const cities = world.map.cities.filter((c) =>
    c.tiles.some((t) => Math.max(Math.abs(tileX(grid, t) - x), Math.abs(tileY(grid, t) - y)) <= radius),
  );
  const supplies = new Set<CargoId>();
  const accepts = new Set<CargoId>();
  for (const ind of industries) {
    const def = INDUSTRIES[ind.type];
    supplies.add(def.output);
    for (const c of Object.keys(def.inputs ?? {}) as CargoId[]) accepts.add(c);
  }
  for (const c of cities) for (const cargo of Object.keys(c.demand) as CargoId[]) accepts.add(cargo);
  return { industries, cities, supplies, accepts };
}

export const stationCoverage = (world: World, station: Station): Coverage => coverageAt(world, station.kind, station.tile);

export interface Consumer {
  kind: 'industry' | 'city';
  id: number;
  name: string;
  x: number;
  y: number;
}

/** The consumer of `cargo` within a station's catchment that is closest to the station. */
export function findConsumer(world: World, cov: Coverage, tile: number, cargo: CargoId): Consumer | null {
  const sx = tileX(world.grid, tile) + 0.5;
  const sy = tileY(world.grid, tile) + 0.5;
  let best: Consumer | null = null;
  let bestD = Infinity;
  for (const ind of cov.industries) {
    if (!INDUSTRIES[ind.type].inputs?.[cargo]) continue;
    const [x, y] = industryCenter(ind);
    const d = euclid(sx, sy, x, y);
    if (d < bestD) {
      bestD = d;
      best = { kind: 'industry', id: ind.id, name: ind.name, x, y };
    }
  }
  for (const c of cov.cities) {
    if (!c.demand[cargo]) continue;
    const d = euclid(sx, sy, c.x + 0.5, c.y + 0.5);
    if (d < bestD) {
      bestD = d;
      best = { kind: 'city', id: c.id, name: c.name, x: c.x + 0.5, y: c.y + 0.5 };
    }
  }
  return best;
}

/**
 * Revenue for a delivery: amount × base price × market multiplier × straight-line distance
 * (in tiles) between the industry where the goods came from and where they are delivered.
 */
export function revenueFor(cargo: CargoId, amount: number, distance: number, priceIndex: number): number {
  return amount * CARGO[cargo].price * priceIndex * Math.max(1, distance);
}

export function hasActiveLine(world: World, station: Station): boolean {
  return world.state.lines.some(
    (l) => l.stations.includes(station.id) && world.state.vehicles.some((v) => v.lineId === l.id),
  );
}

/** Expected units per turn a station would get from an industry (production is split between stations). */
export function supplyPerTurn(world: World, ind: Industry, station: Station): number {
  const def = INDUSTRIES[ind.type];
  const base = def.inputs ? ind.stats.produced : ind.rate;
  const competing = world.state.stations.filter(
    (s) => s.id !== station.id && coversIndustry(s.kind, s.tile, world.grid.width, ind) && hasActiveLine(world, s),
  ).length;
  return base / (competing + 1);
}

export interface FlowEstimate {
  cargo: CargoId;
  /** 0 = from the first to the second station, 1 = back. */
  direction: 0 | 1;
  origin: { id: number; name: string };
  consumer: Consumer;
  distance: number;
  unitRevenue: number;
  supplyPerTurn: number;
  amountPerTurn: number;
  revenuePerTurn: number;
}

/** Possible cargo flows between two stations (both directions), ignoring vehicle capacity. */
export function lineFlows(world: World, a: Station, b: Station): FlowEstimate[] {
  const flows: FlowEstimate[] = [];
  const covA = stationCoverage(world, a);
  const covB = stationCoverage(world, b);
  const pairs: [Station, Coverage, Station, Coverage, 0 | 1][] = [
    [a, covA, b, covB, 0],
    [b, covB, a, covA, 1],
  ];
  for (const [src, srcCov, dst, dstCov, direction] of pairs) {
    for (const ind of srcCov.industries) {
      const cargo = INDUSTRIES[ind.type].output;
      if (!dstCov.accepts.has(cargo)) continue;
      const consumer = findConsumer(world, dstCov, dst.tile, cargo);
      if (!consumer) continue;
      const [ox, oy] = industryCenter(ind);
      const distance = euclid(ox, oy, consumer.x, consumer.y);
      flows.push({
        cargo,
        direction,
        origin: { id: ind.id, name: ind.name },
        consumer,
        distance,
        unitRevenue: revenueFor(cargo, 1, distance, world.state.market.prices[cargo] ?? 1),
        supplyPerTurn: supplyPerTurn(world, ind, src),
        amountPerTurn: 0,
        revenuePerTurn: 0,
      });
    }
  }
  return flows;
}

export interface LineEstimate {
  connected: boolean;
  /** Route length in tiles (estimated as 1.25 × straight line when not connected). */
  length: number;
  /** Ticks for a single trip including loading. */
  tripTicks: number;
  /** Turns until a vehicle has driven from A to B (first income). */
  firstDeliveryTurns: number;
  roundTripTurns: number;
  capacityPerTurn: number;
  flows: FlowEstimate[];
  revenuePerTurn: number;
  upkeepPerTurn: number;
  netPerTurn: number;
  investment: number;
  paybackTurns: number | null;
}

/** Rough expected earnings of `count` vehicles of `model` between the stations on two tiles. */
export function estimateLine(
  world: World,
  player: PlayerId,
  model: VehicleModelId,
  fromTile: number,
  toTile: number,
  count: number,
): LineEstimate | null {
  const a = world.stationAt.get(fromTile);
  const b = world.stationAt.get(toTile);
  const m = VEHICLES[model];
  if (!a || !b || a.id === b.id || !m) return null;
  const route = findRoute(world, player, m.kind, a.tile, b.tile);
  const grid = world.grid;
  const straight = euclid(tileX(grid, a.tile), tileY(grid, a.tile), tileX(grid, b.tile), tileY(grid, b.tile));
  const length = route?.length ?? straight * 1.25;
  const tripTicks = length / (m.speed / TICKS_PER_TURN) + LOAD_TICKS;
  const roundTripTicks = 2 * tripTicks;
  const tripsPerTurn = TICKS_PER_TURN / roundTripTicks;
  const capacityPerTurn = tripsPerTurn * m.capacity * count;
  const flows = lineFlows(world, a, b);
  for (const direction of [0, 1] as const) {
    const dirFlows = flows.filter((f) => f.direction === direction);
    const supply = dirFlows.reduce((s, f) => s + f.supplyPerTurn, 0);
    if (supply <= 0) continue;
    const carried = Math.min(supply, capacityPerTurn);
    for (const f of dirFlows) {
      f.amountPerTurn = (carried * f.supplyPerTurn) / supply;
      f.revenuePerTurn = f.amountPerTurn * f.unitRevenue;
    }
  }
  const revenuePerTurn = flows.reduce((s, f) => s + f.revenuePerTurn, 0);
  const upkeepPerTurn = m.upkeep * count;
  const netPerTurn = revenuePerTurn - upkeepPerTurn;
  const investment = m.price * count;
  return {
    connected: !!route,
    length,
    tripTicks,
    firstDeliveryTurns: tripTicks / TICKS_PER_TURN,
    roundTripTurns: roundTripTicks / TICKS_PER_TURN,
    capacityPerTurn,
    flows,
    revenuePerTurn,
    upkeepPerTurn,
    netPerTurn,
    investment,
    paybackTurns: netPerTurn > 0 ? investment / netPerTurn : null,
  };
}
