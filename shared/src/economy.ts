// Station catchment areas, cargo acceptance, revenue and estimates for the UI.
import { majorityHolder, tollsFor } from './auctions';
import { CARGO, HQ_BONUS, INDUSTRIES, LOAD_TICKS, PASSENGERS_PER_INHABITANT, STATIONS, TICKS_PER_TURN, VEHICLES } from './config';
import { chebyshev, distToRect, euclid, tileX, tileY } from './geometry';
import type { Grid } from './geometry';
import { findRoute } from './pathfind';
import { Routing, stationDistance, visitedStations } from './transfer';
import type { OnwardLeg, RouteLink } from './transfer';
import type { CargoId, CargoLeg, City, GameState, Industry, Line, PlayerId, Station, StationKind, VehicleModelId } from './types';
import type { World } from './world';

export interface Coverage {
  industries: Industry[];
  /** Covered cities: they want goods, and send and receive passengers. */
  cities: City[];
  /** Freight produced by covered industries. */
  supplies: Set<CargoId>;
  /** Freight wanted by covered industries or cities (passengers are handled separately). */
  accepts: Set<CargoId>;
}

export type Carries = 'cargo' | 'passengers';

export function industryCenter(ind: Industry): [number, number] {
  return [ind.x + ind.w / 2, ind.y + ind.h / 2];
}

export function cityCenter(city: City): [number, number] {
  return [city.x + 0.5, city.y + 0.5];
}

/** Passengers per turn that want to travel from a city to another city. */
export function cityPassengers(city: City): number {
  return Math.round(city.population * PASSENGERS_PER_INHABITANT);
}

/** Price multiplier of a cargo (passengers have a fixed price). */
export function cargoPrice(state: GameState, cargo: CargoId): number {
  return CARGO[cargo].market === false ? 1 : (state.market.prices[cargo] ?? 1);
}

/** Is `tile` within the bonus area around a headquarters? */
export function inHqZone(grid: Grid, hq: number, tile: number): boolean {
  return chebyshev(tileX(grid, hq), tileY(grid, hq), tileX(grid, tile), tileY(grid, tile)) <= HQ_BONUS.radius;
}

/** Deliveries between stations on these tiles earn the headquarters bonus when all of them lie near the player's HQ. */
export function hqBonusApplies(world: World, player: PlayerId, tiles: number[]): boolean {
  const hq = world.state.players.find((p) => p.id === player)?.hq;
  if (hq === null || hq === undefined) return false;
  return tiles.every((t) => inHqZone(world.grid, hq, t));
}

/** May `player` pick up cargo at the industry? Not when somebody else (and no ally) owns the majority of its shares. */
export function pickupAllowed(world: World, ind: Industry, player: PlayerId): boolean {
  const holder = majorityHolder(ind);
  return !holder || world.canUse([holder], player);
}

/** Fraction of revenue from this industry's cargo that `player` pays to the other shareholders. */
export function tollRate(ind: Industry, player: PlayerId): number {
  return tollsFor(ind, player).reduce((s, t) => s + t.part, 0);
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

/** The city (other than the one passengers come from) in a station's catchment that is closest to the station. */
export function findPassengerDestination(world: World, cov: Coverage, tile: number, originCity: number): Consumer | null {
  const sx = tileX(world.grid, tile) + 0.5;
  const sy = tileY(world.grid, tile) + 0.5;
  let best: Consumer | null = null;
  let bestD = Infinity;
  for (const c of cov.cities) {
    if (c.id === originCity) continue;
    const [x, y] = cityCenter(c);
    const d = euclid(sx, sy, x, y);
    if (d < bestD) {
      bestD = d;
      best = { kind: 'city', id: c.id, name: c.name, x, y };
    }
  }
  return best;
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

export function hasActiveLine(world: World, station: Station, carries: Carries = 'cargo'): boolean {
  return world.state.lines.some(
    (l) => (l.carries ?? 'cargo') === carries && l.stations.includes(station.id) && world.state.vehicles.some((v) => v.lineId === l.id),
  );
}

/** Expected units per turn a station would get from an industry (production is split between stations). */
export function supplyPerTurn(world: World, ind: Industry, station: Station, player?: PlayerId): number {
  if (player && !pickupAllowed(world, ind, player)) return 0;
  const def = INDUSTRIES[ind.type];
  const base = def.inputs ? ind.stats.produced : ind.rate;
  const competing = world.state.stations.filter(
    (s) => s.id !== station.id && coversIndustry(s.kind, s.tile, world.grid.width, ind) && hasActiveLine(world, s),
  ).length;
  return base / (competing + 1);
}

/** Expected passengers per turn a station gets from a city (split between stations with passenger lines). */
export function passengerSupplyPerTurn(world: World, city: City, station: Station): number {
  const competing = world.state.stations.filter(
    (s) => s.id !== station.id && coverageAt(world, s.kind, s.tile).cities.includes(city) && hasActiveLine(world, s, 'passengers'),
  ).length;
  return cityPassengers(city) / (competing + 1);
}

export interface FlowEstimate {
  cargo: CargoId;
  /** 0 = from the first to the second station, 1 = back. */
  direction: 0 | 1;
  /** Industry, or city for passengers. */
  origin: { id: number; name: string };
  consumer: Consumer;
  distance: number;
  /** What the player keeps per unit: price × distance, plus headquarters bonus, minus tolls. */
  unitRevenue: number;
  /** Fraction of the revenue paid to other shareholders of the industry. */
  toll: number;
  /** Majority shareholder that keeps the player away from this industry. */
  excludedBy: PlayerId | null;
  supplyPerTurn: number;
  amountPerTurn: number;
  revenuePerTurn: number;
  /** Transshipment: stations where the cargo changes to another line, in order. */
  via?: string[];
  /** Transshipment: this line's part of the revenue of the whole journey (by distance). */
  share?: number;
  /** The cargo is handed over to this line at its first station by another line. */
  inbound?: boolean;
}

const lengths = new WeakMap<World, Map<number, number | null>>();

/** Route length of a line: from the last turn, or (for a new line) over the current network. */
export function lineLength(world: World, line: Line): number | null {
  if (line.length !== null && line.length !== undefined) return line.length;
  let cache = lengths.get(world);
  if (!cache) lengths.set(world, (cache = new Map()));
  if (!cache.has(line.id)) {
    const a = world.stationById.get(line.stations[0]);
    const b = world.stationById.get(line.stations[1]);
    cache.set(line.id, a && b ? (findRoute(world, line.owner, line.kind, a.tile, b.tile)?.length ?? null) : null);
  }
  return cache.get(line.id)!;
}

/** Freight lines with vehicles, for the routing of transshipments. */
export function freightLinks(world: World): RouteLink[] {
  const running = new Set(world.state.vehicles.map((v) => v.lineId));
  const links: RouteLink[] = [];
  for (const line of world.state.lines) {
    if ((line.carries ?? 'cargo') !== 'cargo' || !running.has(line.id)) continue;
    const length = lineLength(world, line);
    if (length !== null) links.push({ line: line.id, owner: line.owner, a: line.stations[0], b: line.stations[1], length });
  }
  return links;
}

/** Freight per turn a line can carry in one direction with its vehicles. */
function linkCapacity(world: World, link: RouteLink): number {
  let capacity = 0;
  for (const v of world.state.vehicles) {
    if (v.lineId !== link.line) continue;
    const m = VEHICLES[v.model];
    const tripTicks = link.length / (m.speed / TICKS_PER_TURN) + LOAD_TICKS;
    capacity += (m.capacity * TICKS_PER_TURN) / (2 * tripTicks);
  }
  return capacity;
}

interface Inflow {
  cargo: CargoId;
  origin: Industry;
  amount: number;
  legs: CargoLeg[];
}

/**
 * Estimated freight per turn that other lines hand over at a station (transshipment), following feeder
 * lines back to the industries. `skip` leaves out the line that is being estimated.
 */
function inflows(world: World, routing: Routing, skip: (link: RouteLink) => boolean, cov: (s: Station) => Coverage) {
  const memo = new Map<number, Inflow[] | null>();
  const at = (station: Station): Inflow[] => {
    const known = memo.get(station.id);
    if (known !== undefined) return known ?? []; // null: being worked out (a loop in the network)
    memo.set(station.id, null);
    const result: Inflow[] = [];
    for (const link of routing.links) {
      if (skip(link)) continue;
      for (const [xId, yId] of [
        [link.a, link.b],
        [link.b, link.a],
      ]) {
        const x = world.stationById.get(xId)!;
        const y = world.stationById.get(yId)!;
        /** Is cargo that has been at `seen` (and now rides from x to y) handed over at y to this station? */
        const handedHere = (c: CargoId, seen: Set<number>) =>
          !seen.has(y.id) && !routing.accepts(y).has(c) && routing.handover(y, c, seen)?.id === station.id;
        const leg: CargoLeg = { player: link.owner, line: link.line, from: x.id, to: y.id, distance: stationDistance(world, x, y) };
        const flows: Inflow[] = [];
        for (const ind of cov(x).industries) {
          const cargo = INDUSTRIES[ind.type].output;
          if (!handedHere(cargo, new Set([x.id])) || !pickupAllowed(world, ind, link.owner)) continue;
          flows.push({ cargo, origin: ind, amount: supplyPerTurn(world, ind, x, link.owner), legs: [leg] });
        }
        for (const f of at(x)) {
          const seen = visitedStations(f);
          seen.add(x.id);
          if (!handedHere(f.cargo, seen)) continue;
          flows.push({ ...f, legs: [...f.legs, leg] });
        }
        const total = flows.reduce((sum, f) => sum + f.amount, 0);
        if (total <= 0) continue;
        const scale = Math.min(1, linkCapacity(world, link) / total);
        for (const f of flows) result.push({ ...f, amount: f.amount * scale });
      }
    }
    memo.set(station.id, result);
    return result;
  };
  return at;
}

/**
 * Possible flows between two stations (both directions), ignoring vehicle capacity: freight from
 * industries, or passengers between cities. `player` (the line owner) decides bonus, tolls and access.
 * Freight also counts when it can be handed over at the other station to a line that takes it further,
 * or when other lines hand it over at the first station (transshipment). `length`: route length of the line.
 */
export function lineFlows(
  world: World,
  a: Station,
  b: Station,
  carries: Carries = 'cargo',
  player?: PlayerId,
  length?: number,
): FlowEstimate[] {
  const flows: FlowEstimate[] = [];
  const covA = stationCoverage(world, a);
  const covB = stationCoverage(world, b);
  const bonus = player && hqBonusApplies(world, player, [a.tile, b.tile]) ? 1 + HQ_BONUS.bonus : 1;
  const coverage = new Map<number, Coverage>([
    [a.id, covA],
    [b.id, covB],
  ]);
  const cov = (s: Station) => coverage.get(s.id) ?? coverage.set(s.id, stationCoverage(world, s)).get(s.id)!;
  // Transshipment: the running freight lines of the player and allies, plus this line.
  let routing: Routing | null = null;
  let inflowAt: ((s: Station) => Inflow[]) | null = null;
  if (carries === 'cargo' && player) {
    const links = freightLinks(world);
    const isThisLine = (l: RouteLink) => l.owner === player && ((l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id));
    if (!links.some(isThisLine)) {
      links.push({ line: -1, owner: player, a: a.id, b: b.id, length: length ?? stationDistance(world, a, b) * 1.25 });
    }
    routing = new Routing(world, player, links, (s) => cov(s).accepts);
    inflowAt = inflows(world, routing, isThisLine, cov);
  }
  const pairs: [Station, Coverage, Station, Coverage, 0 | 1][] = [
    [a, covA, b, covB, 0],
    [b, covB, a, covA, 1],
  ];
  for (const [src, srcCov, dst, dstCov, direction] of pairs) {
    if (carries === 'passengers') {
      for (const city of srcCov.cities) {
        const consumer = findPassengerDestination(world, dstCov, dst.tile, city.id);
        if (!consumer) continue;
        const [ox, oy] = cityCenter(city);
        const distance = euclid(ox, oy, consumer.x, consumer.y);
        flows.push({
          cargo: 'passengers',
          direction,
          origin: { id: city.id, name: city.name },
          consumer,
          distance,
          unitRevenue: revenueFor('passengers', 1, distance, 1) * bonus,
          toll: 0,
          excludedBy: null,
          supplyPerTurn: passengerSupplyPerTurn(world, city, src),
          amountPerTurn: 0,
          revenuePerTurn: 0,
        });
      }
      continue;
    }
    const here = stationDistance(world, src, dst);
    /** A flow of freight from an industry over this line, to a customer at `end` (after the onward legs). */
    const freight = (ind: Industry, end: Station, before: number[], after: OnwardLeg[], extra: Partial<FlowEstimate>) => {
      const cargo = INDUSTRIES[ind.type].output;
      const consumer = findConsumer(world, cov(end), end.tile, cargo);
      if (!consumer) return;
      const [ox, oy] = industryCenter(ind);
      const distance = euclid(ox, oy, consumer.x, consumer.y);
      const toll = player ? tollRate(ind, player) : 0;
      const excludedBy = player && !pickupAllowed(world, ind, player) ? majorityHolder(ind) : null;
      const legs = [...before, here, ...after.map((l) => stationDistance(world, l.from, l.to))];
      const share = legs.length > 1 ? here / legs.reduce((sum, d) => sum + d, 0) : 1;
      flows.push({
        cargo,
        direction,
        origin: { id: ind.id, name: ind.name },
        consumer,
        distance,
        unitRevenue: revenueFor(cargo, 1, distance, cargoPrice(world.state, cargo)) * bonus * (1 - toll) * share,
        toll,
        excludedBy,
        supplyPerTurn: 0,
        amountPerTurn: 0,
        revenuePerTurn: 0,
        ...(legs.length > 1 ? { share, via: [...(extra.inbound ? [src.name] : []), ...after.map((l) => l.from.name)] } : {}),
        ...extra,
      });
    };
    for (const ind of srcCov.industries) {
      const cargo = INDUSTRIES[ind.type].output;
      const supply = supplyPerTurn(world, ind, src, player);
      if (dstCov.accepts.has(cargo)) {
        freight(ind, dst, [], [], { supplyPerTurn: supply });
        continue;
      }
      // Handed over at the other station to a line that takes it further.
      const onward = routing?.onward(dst, cargo, new Set([src.id]));
      if (onward) freight(ind, onward.end, [], onward.legs, { supplyPerTurn: supply });
    }
    // Handed over at this station by other lines.
    for (const f of inflowAt?.(src) ?? []) {
      const seen = visitedStations(f);
      seen.add(src.id);
      if (seen.has(dst.id) || !routing) continue;
      const before = f.legs.map((l) => l.distance);
      if (dstCov.accepts.has(f.cargo)) {
        freight(f.origin, dst, before, [], { supplyPerTurn: f.amount, inbound: true });
        continue;
      }
      const onward = routing.onward(dst, f.cargo, seen);
      if (onward) freight(f.origin, onward.end, before, onward.legs, { supplyPerTurn: f.amount, inbound: true });
    }
  }
  return flows;
}

export interface LineEstimate {
  connected: boolean;
  /** Both stations lie near the player's headquarters: deliveries earn the bonus. */
  hqBonus: boolean;
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
  const flows = lineFlows(world, a, b, m.carries, player, length);
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
    hqBonus: hqBonusApplies(world, player, [a.tile, b.tile]),
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
