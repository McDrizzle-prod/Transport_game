// Economic simulation of one turn: production, loading, driving, delivering and upkeep.
// Vehicles move at their own speed; revenue is only earned when a vehicle arrives at the other station.
import { majorityHolder, tollsFor } from './auctions';
import {
  CITY_STOCK_TURNS,
  HQ_BONUS,
  INDUSTRIES,
  LOAD_TICKS,
  OVERSUPPLY_PRICE_FACTOR,
  STATIONS,
  STATION_WAITING_CAP,
  TICKS_PER_TURN,
  TRANSPORT,
  VEHICLES,
} from './config';
import {
  cargoPrice,
  cityCenter,
  cityPassengers,
  findConsumer,
  findPassengerDestination,
  hqBonusApplies,
  industryCenter,
  revenueFor,
  stationCoverage,
} from './economy';
import type { Consumer, Coverage } from './economy';
import { euclid, tileX, tileY } from './geometry';
import { findRoute, pointOnRoute } from './pathfind';
import type { Route } from './pathfind';
import type { CargoAmounts, CargoId, CargoLot, Delivery, Finance, Line, PlayerId, Station, TurnReport, Vehicle } from './types';
import type { World } from './world';

/** Integer part of `total` produced during tick `t`; the parts add up to exactly `total` per turn. */
export function tickShare(total: number, t: number): number {
  return Math.floor(((t + 1) * total) / TICKS_PER_TURN) - Math.floor((t * total) / TICKS_PER_TURN);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function cargoOnBoard(v: Vehicle): number {
  return v.cargo.reduce((s, l) => s + l.amount, 0);
}

function addLot(lots: CargoLot[], cargo: CargoId, amount: number, origin: number): void {
  const lot = lots.find((l) => l.cargo === cargo && l.origin === origin);
  if (lot) lot.amount += amount;
  else lots.push({ cargo, amount, origin });
}

function waitingAmount(station: Station, cargo: CargoId): number {
  return station.waiting.reduce((s, l) => (l.cargo === cargo ? s + l.amount : s), 0);
}

/** Runs the simulation for one turn. Returns the units delivered per cargo (market supply). */
export function simulateTurn(world: World, report: TurnReport, fin: Record<PlayerId, Finance>): CargoAmounts {
  const state = world.state;
  const coverage = new Map<number, Coverage>();
  for (const s of state.stations) coverage.set(s.id, stationCoverage(world, s));

  const routes = new Map<number, Route | null>();
  const vehiclesByLine = new Map<number, Vehicle[]>();
  for (const v of state.vehicles) {
    const list = vehiclesByLine.get(v.lineId);
    if (list) list.push(v);
    else vehiclesByLine.set(v.lineId, [v]);
  }
  for (const line of state.lines) {
    const a = world.stationById.get(line.stations[0]);
    const b = world.stationById.get(line.stations[1]);
    const route = a && b ? findRoute(world, line.owner, line.kind, a.tile, b.tile) : null;
    routes.set(line.id, route);
    line.length = route ? round2(route.length) : null;
    line.stats = { trips: 0, revenue: 0, delivered: {} };
  }

  // Each station collects what the other end of one of its active lines accepts: freight for freight
  // lines, passengers for passenger lines that lead to another city. Per cargo: the owners of those lines.
  const wants = new Map<number, Map<CargoId, Set<PlayerId>>>();
  const want = (station: number, cargo: CargoId, owner: PlayerId) => {
    let perCargo = wants.get(station);
    if (!perCargo) wants.set(station, (perCargo = new Map()));
    const owners = perCargo.get(cargo);
    if (owners) owners.add(owner);
    else perCargo.set(cargo, new Set([owner]));
  };
  const leadsToOtherCity = (from: Coverage, to: Coverage) => to.cities.some((c) => !from.cities.includes(c));
  for (const line of state.lines) {
    if (!routes.get(line.id) || !vehiclesByLine.get(line.id)?.length) continue;
    const [a, b] = line.stations;
    const covA = coverage.get(a);
    const covB = coverage.get(b);
    if (!covA || !covB) continue;
    if (line.carries === 'passengers') {
      if (leadsToOtherCity(covA, covB)) want(a, 'passengers', line.owner);
      if (leadsToOtherCity(covB, covA)) want(b, 'passengers', line.owner);
    } else {
      for (const c of covB.accepts) want(a, c, line.owner);
      for (const c of covA.accepts) want(b, c, line.owner);
    }
  }
  // An industry whose majority shareholder decides who may load there only supplies stations of
  // lines of that player and allies.
  const pickup = new Map<number, Station[]>();
  for (const ind of state.industries) {
    const out = INDUSTRIES[ind.type].output;
    const holder = majorityHolder(ind);
    pickup.set(
      ind.id,
      state.stations.filter((s) => {
        const owners = wants.get(s.id)?.get(out);
        if (!owners || !coverage.get(s.id)!.industries.includes(ind)) return false;
        return !holder || [...owners].some((o) => world.canUse([holder], o));
      }),
    );
    ind.stats = { produced: 0, shipped: 0, received: {} };
  }
  const cityPickup = new Map<number, Station[]>();
  for (const city of world.map.cities) {
    cityPickup.set(
      city.id,
      state.stations.filter((s) => wants.get(s.id)?.has('passengers') && coverage.get(s.id)!.cities.includes(city)),
    );
  }

  const cityDelivered = new Map<number, CargoAmounts>();
  const supply: CargoAmounts = {};
  const deliveries = new Map<string, Delivery>();
  for (const v of state.vehicles) {
    v.stats.trips = 0;
    v.stats.revenue = 0;
  }

  const position = (v: Vehicle): [number, number] => {
    const line = world.lineById.get(v.lineId);
    const station = line ? world.stationById.get(line.stations[v.dir]) : undefined;
    const route = line ? routes.get(line.id) : null;
    if (route && v.state === 'moving') return pointOnRoute(world, route, v.dir === 0 ? v.progress : route.length - v.progress);
    if (!station) return [0, 0];
    return [tileX(world.grid, station.tile) + 0.5, tileY(world.grid, station.tile) + 0.5];
  };
  const frames = new Map<number, number[]>();
  const record = (v: Vehicle) => {
    const [x, y] = position(v);
    let f = frames.get(v.id);
    if (!f) frames.set(v.id, (f = []));
    f.push(round2(x), round2(y));
  };
  for (const v of state.vehicles) record(v);

  const produce = (t: number) => {
    for (const ind of state.industries) {
      const def = INDUSTRIES[ind.type];
      if (!def.inputs) {
        const amount = tickShare(ind.rate, t);
        ind.stats.produced += amount;
        ind.stock = Math.min(ind.stock + amount, ind.rate * 2);
        continue;
      }
      let possible = tickShare(ind.rate, t);
      const inputs = Object.entries(def.inputs) as [CargoId, number][];
      for (const [c, ratio] of inputs) possible = Math.min(possible, Math.floor((ind.input[c] ?? 0) / ratio));
      if (possible <= 0) continue;
      for (const [c, ratio] of inputs) ind.input[c] = (ind.input[c] ?? 0) - possible * ratio;
      ind.stock = Math.min(ind.stock + possible, ind.rate * 3);
      ind.stats.produced += possible;
    }
    for (const city of world.map.cities) {
      const rate = cityPassengers(city);
      state.cityStock[city.id] = Math.min((state.cityStock[city.id] ?? 0) + tickShare(rate, t), rate * CITY_STOCK_TURNS);
    }
  };

  /** Splits `stock` fairly over the stations (rotating who gets the remainder); returns what was handed out. */
  const share = (stock: number, stations: Station[], cargo: CargoId, origin: number, t: number): number => {
    const n = stations.length;
    if (n === 0 || stock <= 0) return 0;
    const per = Math.floor(stock / n);
    const rem = stock % n;
    let given = 0;
    for (let k = 0; k < n; k++) {
      const station = stations[(k + t) % n];
      const room = STATION_WAITING_CAP - waitingAmount(station, cargo);
      const amount = Math.min(per + (k < rem ? 1 : 0), room);
      if (amount <= 0) continue;
      addLot(station.waiting, cargo, amount, origin);
      given += amount;
    }
    return given;
  };

  const distribute = (t: number) => {
    for (const ind of state.industries) {
      const given = share(ind.stock, pickup.get(ind.id) ?? [], INDUSTRIES[ind.type].output, ind.id, t);
      ind.stock -= given;
      ind.stats.shipped += given;
    }
    for (const city of world.map.cities) {
      const waiting = state.cityStock[city.id] ?? 0;
      state.cityStock[city.id] = waiting - share(waiting, cityPickup.get(city.id) ?? [], 'passengers', city.id, t);
    }
  };

  const load = (v: Vehicle, here: Station, there: Station) => {
    const cov = coverage.get(there.id);
    if (!cov) return;
    const passengers = VEHICLES[v.model].carries === 'passengers';
    let free = VEHICLES[v.model].capacity - cargoOnBoard(v);
    for (const lot of here.waiting) {
      if (free <= 0) break;
      if (lot.amount <= 0) continue;
      if (passengers) {
        if (lot.cargo !== 'passengers' || !cov.cities.some((c) => c.id !== lot.origin)) continue;
      } else {
        if (lot.cargo === 'passengers' || !cov.accepts.has(lot.cargo)) continue;
        const ind = world.industryById.get(lot.origin);
        const holder = ind ? majorityHolder(ind) : null;
        if (holder && !world.canUse([holder], v.owner)) continue;
      }
      const take = Math.min(free, lot.amount);
      lot.amount -= take;
      free -= take;
      addLot(v.cargo, lot.cargo, take, lot.origin);
    }
    here.waiting = here.waiting.filter((l) => l.amount > 0);
  };

  const bonusLines = new Set(
    state.lines.filter((l) => {
      const a = world.stationById.get(l.stations[0]);
      const b = world.stationById.get(l.stations[1]);
      return !!a && !!b && hqBonusApplies(world, l.owner, [a.tile, b.tile]);
    }).map((l) => l.id),
  );

  const unload = (v: Vehicle, station: Station, line: Line, t: number) => {
    const cov = coverage.get(station.id);
    const owner = state.players.find((p) => p.id === v.owner);
    if (!cov || !owner) {
      v.cargo = [];
      return;
    }
    const sx = tileX(world.grid, station.tile) + 0.5;
    const sy = tileY(world.grid, station.tile) + 0.5;
    for (const lot of v.cargo) {
      const isPassengers = lot.cargo === 'passengers';
      const consumer: Consumer | null = isPassengers
        ? findPassengerDestination(world, cov, station.tile, lot.origin)
        : findConsumer(world, cov, station.tile, lot.cargo);
      if (!consumer) continue;
      const originCity = isPassengers ? world.cityById.get(lot.origin) : undefined;
      const originIndustry = isPassengers ? undefined : world.industryById.get(lot.origin);
      const [ox, oy] = originCity ? cityCenter(originCity) : originIndustry ? industryCenter(originIndustry) : [consumer.x, consumer.y];
      const distance = euclid(ox, oy, consumer.x, consumer.y);
      const price = cargoPrice(state, lot.cargo);
      let gross: number;
      if (consumer.kind === 'city') {
        const city = world.cityById.get(consumer.id)!;
        const got = cityDelivered.get(city.id) ?? {};
        const before = got[lot.cargo] ?? 0;
        // Passengers are always welcome; goods above the city's demand earn less.
        const full = isPassengers ? lot.amount : Math.max(0, Math.min(lot.amount, (city.demand[lot.cargo] ?? 0) - before));
        gross =
          revenueFor(lot.cargo, full, distance, price) +
          revenueFor(lot.cargo, lot.amount - full, distance, price * OVERSUPPLY_PRICE_FACTOR);
        got[lot.cargo] = before + lot.amount;
        cityDelivered.set(city.id, got);
      } else {
        const ind = world.industryById.get(consumer.id)!;
        ind.input[lot.cargo] = Math.min((ind.input[lot.cargo] ?? 0) + lot.amount, ind.rate * 4);
        ind.stats.received[lot.cargo] = (ind.stats.received[lot.cargo] ?? 0) + lot.amount;
        gross = revenueFor(lot.cargo, lot.amount, distance, price);
      }
      const base = Math.round(gross);
      const bonus = bonusLines.has(line.id) ? Math.round(base * HQ_BONUS.bonus) : 0;
      const revenue = base + bonus;
      // Shareholders of the industry the cargo came from get their part.
      let toll = 0;
      for (const { holder, part } of originIndustry ? tollsFor(originIndustry, owner.id) : []) {
        const shareholder = state.players.find((p) => p.id === holder);
        const amount = Math.round(revenue * part);
        if (!shareholder || amount <= 0) continue;
        shareholder.money += amount;
        if (fin[holder]) fin[holder].dividends += amount;
        toll += amount;
      }
      const net = revenue - toll;
      owner.money += net;
      if (fin[owner.id]) {
        fin[owner.id].revenue += revenue;
        fin[owner.id].tolls += toll;
      }
      v.stats.revenue += net;
      v.stats.revenueTotal += net;
      line.stats.revenue += net;
      line.stats.delivered[lot.cargo] = (line.stats.delivered[lot.cargo] ?? 0) + lot.amount;
      supply[lot.cargo] = (supply[lot.cargo] ?? 0) + lot.amount;
      const key = `${owner.id}:${line.id}:${lot.cargo}`;
      const d = deliveries.get(key) ?? { player: owner.id, lineId: line.id, cargo: lot.cargo, amount: 0, revenue: 0, bonus: 0, toll: 0, trips: 0 };
      d.amount += lot.amount;
      d.revenue += revenue;
      d.bonus += bonus;
      d.toll += toll;
      d.trips += 1;
      deliveries.set(key, d);
      report.replay.events.push({ tick: t, vehicle: v.id, player: owner.id, x: sx, y: sy, cargo: lot.cargo, amount: lot.amount, revenue: net });
    }
    v.cargo = [];
  };

  const step = (v: Vehicle, t: number) => {
    const line = world.lineById.get(v.lineId);
    const route = line ? routes.get(line.id) : null;
    if (!line || !route) {
      v.state = 'blocked';
      return;
    }
    if (v.state === 'blocked') {
      v.state = 'loading';
      v.progress = 0;
      v.wait = LOAD_TICKS;
    }
    if (v.state === 'loading') {
      const here = world.stationById.get(line.stations[v.dir])!;
      const there = world.stationById.get(line.stations[1 - v.dir])!;
      load(v, here, there);
      if (v.wait > 0) {
        v.wait--;
        return;
      }
      v.state = 'moving';
      v.progress = 0;
    }
    v.progress += VEHICLES[v.model].speed / TICKS_PER_TURN;
    if (v.progress >= route.length) {
      v.dir = v.dir === 0 ? 1 : 0;
      v.state = 'loading';
      v.progress = 0;
      v.wait = LOAD_TICKS;
      v.stats.trips++;
      line.stats.trips++;
      unload(v, world.stationById.get(line.stations[v.dir])!, line, t);
    }
  };

  for (let t = 0; t < TICKS_PER_TURN; t++) {
    produce(t);
    distribute(t);
    for (const v of state.vehicles) step(v, t);
    for (const v of state.vehicles) record(v);
  }

  for (const v of state.vehicles) v.progress = round2(v.progress);
  state.cityStats = {};
  for (const [id, got] of cityDelivered) state.cityStats[id] = got;
  report.deliveries = [...deliveries.values()];
  report.replay.vehicles = state.vehicles.map((v) => ({ id: v.id, owner: v.owner, model: v.model, frames: frames.get(v.id) ?? [] }));
  return supply;
}

/** Running costs of vehicles, infrastructure and stations (shared infrastructure splits the bill). */
export function chargeUpkeep(world: World, fin: Record<PlayerId, Finance>): void {
  const state = world.state;
  const due = new Map<PlayerId, number>();
  const add = (p: PlayerId, amount: number) => due.set(p, (due.get(p) ?? 0) + amount);
  for (const v of state.vehicles) add(v.owner, VEHICLES[v.model].upkeep);
  for (const e of Object.values(state.infra.edges)) {
    for (const o of e.owners) add(o, TRANSPORT[e.kind].upkeep / e.owners.length);
  }
  for (const s of state.stations) {
    for (const o of s.owners) add(o, STATIONS[s.kind].upkeep / s.owners.length);
  }
  for (const [p, amount] of due) {
    const player = state.players.find((pl) => pl.id === p);
    if (!player) continue;
    const r = Math.round(amount);
    player.money -= r;
    if (fin[p]) fin[p].upkeep += r;
  }
}
