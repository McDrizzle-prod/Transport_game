// Building rules and execution of one action slot, including conflicts between players.
//
// Conflict rule (per tile): slots are executed in order 1..5 for all players at the same time.
// A tile claimed in an earlier slot belongs to that player, so a later claim on it fails.
// When several players claim the same free tile in the same slot, all of them get it (shared tile).
import { LOAD_TICKS, MAX_ROUTE_EDGES, MAX_VEHICLES_PER_ACTION, STATIONS, TERRAIN, TICKS_PER_TURN, TRANSPORT, VEHICLES } from './config';
import { crossingPair, distToRect, edgeKey, isAdjacent, neighbor, stepLength, tileX, tileY, validTile } from './geometry';
import { findRoute } from './pathfind';
import { Terrain, TileUse } from './types';
import type {
  Action,
  BuildAction,
  Line,
  LostTile,
  Msg,
  PlayerId,
  SlotResult,
  Station,
  StationAction,
  StationKind,
  TransportKind,
  Vehicle,
  VehicleAction,
} from './types';
import type { World } from './world';

export type BlockReason = 'bounds' | 'terrain' | 'city' | 'industry' | 'hq' | 'station' | 'occupied' | 'mixed' | 'no_water';

export type TileCheck = { ok: true; claim: boolean } | { ok: false; reason: BlockReason; owners: PlayerId[] };

/** Reasons that depend on other players (and can change during a turn); they cause a partial build. */
const SOFT_BLOCKS: BlockReason[] = ['occupied', 'station', 'hq'];

const isWater = (world: World, t: number) => world.map.terrain[t] === Terrain.Water;
const isStreet = (world: World, t: number) => world.map.use[t] === TileUse.CityStreet;

function blocked(reason: BlockReason, owners: PlayerId[] = []): TileCheck {
  return { ok: false, reason, owners };
}

/** Can `player` lay a route of `kind` over `tile`? */
export function checkRouteTile(world: World, player: PlayerId, kind: TransportKind, tile: number): TileCheck {
  if (!validTile(world.grid, tile)) return blocked('bounds');
  const use = world.map.use[tile];
  if (use === TileUse.Industry) return blocked('industry');
  if (use === TileUse.CityBuilding) return blocked('city');
  if (use === TileUse.CityStreet) return kind === 'road' ? { ok: true, claim: false } : blocked('city');
  const hq = world.hqAt.get(tile);
  if (hq !== undefined) return blocked('hq', [hq]);
  const terrain = TERRAIN[world.map.terrain[tile] as keyof typeof TERRAIN];
  if (kind === 'canal') {
    if (terrain.canal === null) return blocked('terrain');
    if (isWater(world, tile)) return { ok: true, claim: false };
  } else if (terrain.land === null) {
    return blocked('terrain');
  }
  const station = world.stationAt.get(tile);
  if (station) {
    if (STATIONS[station.kind].transport !== kind) return blocked('station', station.owners);
    if (!station.owners.includes(player)) return blocked('station', station.owners);
    return { ok: true, claim: false };
  }
  const info = world.tile(tile);
  if (info && info.owners.length > 0) {
    return info.owners.includes(player) ? { ok: true, claim: false } : blocked('occupied', info.owners);
  }
  return { ok: true, claim: true };
}

export type StationCheck = { ok: true; claim: boolean; exists: boolean } | { ok: false; reason: BlockReason; owners: PlayerId[] };

/** Can `player` place a station of `kind` on `tile`? */
export function checkStationTile(world: World, player: PlayerId, kind: StationKind, tile: number): StationCheck {
  if (!validTile(world.grid, tile)) return { ok: false, reason: 'bounds', owners: [] };
  const use = world.map.use[tile];
  if (use === TileUse.Industry) return { ok: false, reason: 'industry', owners: [] };
  if (use !== TileUse.None) return { ok: false, reason: 'city', owners: [] };
  const hq = world.hqAt.get(tile);
  if (hq !== undefined) return { ok: false, reason: 'hq', owners: [hq] };
  if (!TERRAIN[world.map.terrain[tile] as keyof typeof TERRAIN].buildable) return { ok: false, reason: 'terrain', owners: [] };
  const existing = world.stationAt.get(tile);
  if (existing) {
    if (existing.kind === kind && existing.owners.includes(player)) return { ok: true, claim: false, exists: true };
    return { ok: false, reason: 'station', owners: existing.owners };
  }
  const info = world.tile(tile);
  if (info && info.owners.length > 0 && !info.owners.includes(player)) {
    return { ok: false, reason: 'occupied', owners: info.owners };
  }
  const transport = STATIONS[kind].transport;
  if (world.edgesAt(tile).some((e) => e.kind !== transport)) return { ok: false, reason: 'mixed', owners: [] };
  if (kind === 'water') {
    let water = false;
    for (let d = 0; d < 8 && !water; d++) {
      const nb = neighbor(world.grid, tile, d);
      if (nb >= 0 && (isWater(world, nb) || world.edgesAt(nb).some((e) => e.kind === 'canal'))) water = true;
    }
    if (!water) return { ok: false, reason: 'no_water', owners: [] };
  }
  return { ok: true, claim: !info || info.owners.length === 0, exists: false };
}

/** Whether a step between two tiles needs a built edge (open water and city streets are already there). */
export function edgeNeeded(world: World, kind: TransportKind, a: number, b: number): boolean {
  if (kind === 'canal') return !(isWater(world, a) && isWater(world, b));
  if (kind === 'road') return !(isStreet(world, a) && isStreet(world, b));
  return true;
}

/** Steps that are never allowed, regardless of ownership. */
export function stepAllowed(world: World, kind: TransportKind, a: number, b: number): boolean {
  if (!isAdjacent(world.grid, a, b)) return false;
  // City streets form a straight grid; no diagonal short cuts between blocks.
  if (kind === 'road' && isStreet(world, a) && isStreet(world, b) && stepLength(world.grid, a, b) > 1) return false;
  return true;
}

/** Owners of an edge that would cross the diagonal step a→b (diagonals may not cross without a junction). */
export function crossingOwners(world: World, a: number, b: number): PlayerId[] | null {
  const pair = crossingPair(world.grid, a, b);
  if (!pair) return null;
  for (const e of world.edgesAt(pair[0])) {
    if ((e.a === pair[0] && e.b === pair[1]) || (e.a === pair[1] && e.b === pair[0])) return e.owners;
  }
  return null;
}

export function edgeCost(world: World, kind: TransportKind, a: number, b: number): number {
  const mul = (t: number) => {
    const def = TERRAIN[world.map.terrain[t] as keyof typeof TERRAIN];
    return (kind === 'canal' ? def.canal : def.land) ?? Infinity;
  };
  return Math.round(TRANSPORT[kind].edgeCost * Math.max(mul(a), mul(b)) * stepLength(world.grid, a, b));
}

// ---------------------------------------------------------------------------
// Plans: what an action would build, computed against the current world.

export interface PlannedEdge {
  key: string;
  kind: TransportKind;
  a: number;
  b: number;
  cost: number;
}

export interface PlannedStation {
  kind: StationKind;
  tile: number;
  cost: number;
}

export interface ConstructionPlan {
  claims: number[];
  edges: PlannedEdge[];
  stations: PlannedStation[];
  blocked: { tile: number; owners: PlayerId[]; reason: BlockReason }[];
  messages: Msg[];
  fatal: Msg | null;
  cost: number;
}

function emptyPlan(): ConstructionPlan {
  return { claims: [], edges: [], stations: [], blocked: [], messages: [], fatal: null, cost: 0 };
}

function fatalPlan(code: string, extra: Record<string, unknown> = {}): ConstructionPlan {
  return { ...emptyPlan(), fatal: { code, ...extra } };
}

/** Validates the shape of a route path (contiguous, unique, within limits). Returns an error code or null. */
export function pathShapeError(world: World, kind: TransportKind, path: number[]): string | null {
  if (!Array.isArray(path) || path.length < 2) return 'path_too_short';
  if (path.length - 1 > MAX_ROUTE_EDGES) return 'path_too_long';
  const seen = new Set<number>();
  for (let i = 0; i < path.length; i++) {
    const t = path[i];
    if (!validTile(world.grid, t) || seen.has(t)) return 'path_invalid';
    seen.add(t);
    if (i > 0 && !stepAllowed(world, kind, path[i - 1], t)) return 'path_invalid';
  }
  return null;
}

export function planBuild(world: World, player: PlayerId, action: BuildAction): ConstructionPlan {
  const { kind, path } = action;
  const shape = pathShapeError(world, kind, path);
  if (shape) return fatalPlan(shape, { max: MAX_ROUTE_EDGES });

  const plan = emptyPlan();
  const checks = new Map<number, TileCheck>();
  const lost = new Set<number>();
  for (const t of path) {
    const c = checkRouteTile(world, player, kind, t);
    checks.set(t, c);
    if (!c.ok) {
      if (!SOFT_BLOCKS.includes(c.reason)) return fatalPlan('path_blocked', { tile: t, reason: c.reason });
      lost.add(t);
      plan.blocked.push({ tile: t, owners: c.owners, reason: c.reason });
    }
  }

  const needed = new Set<number>();
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (lost.has(a) || lost.has(b) || !edgeNeeded(world, kind, a, b)) continue;
    const key = edgeKey(kind, a, b);
    const existing = world.edge(key);
    if (existing && existing.owners.includes(player)) continue;
    const crossing = crossingOwners(world, a, b);
    if (crossing) {
      plan.blocked.push({ tile: b, owners: crossing, reason: 'occupied' });
      continue;
    }
    plan.edges.push({ key, kind, a, b, cost: edgeCost(world, kind, a, b) });
    needed.add(a);
    needed.add(b);
  }

  const stationKind = TRANSPORT[kind].station;
  const ends: [boolean | undefined, number][] = [
    [action.stationStart, path[0]],
    [action.stationEnd, path[path.length - 1]],
  ];
  for (const [wanted, tile] of ends) {
    if (!wanted || !stationKind || lost.has(tile)) continue;
    const sc = checkStationTile(world, player, stationKind, tile);
    if (!sc.ok) {
      if (SOFT_BLOCKS.includes(sc.reason)) plan.blocked.push({ tile, owners: sc.owners, reason: sc.reason });
      else plan.messages.push({ code: 'station_invalid', tile, reason: sc.reason });
      continue;
    }
    if (sc.exists) continue;
    plan.stations.push({ kind: stationKind, tile, cost: STATIONS[stationKind].cost });
    needed.add(tile);
  }

  plan.claims = [...needed].filter((t) => {
    const c = checks.get(t);
    return c?.ok === true && c.claim;
  });
  plan.cost = plan.edges.reduce((s, e) => s + e.cost, 0) + plan.stations.reduce((s, st) => s + st.cost, 0);
  if (plan.edges.length === 0 && plan.stations.length === 0 && plan.blocked.length === 0) {
    plan.messages.push({ code: 'nothing_to_build' });
  }
  return plan;
}

export function planStation(world: World, player: PlayerId, action: StationAction): ConstructionPlan {
  const plan = emptyPlan();
  const sc = checkStationTile(world, player, action.kind, action.tile);
  if (!sc.ok) {
    if (!SOFT_BLOCKS.includes(sc.reason)) return fatalPlan('station_invalid', { tile: action.tile, reason: sc.reason });
    plan.blocked.push({ tile: action.tile, owners: sc.owners, reason: sc.reason });
    return plan;
  }
  if (sc.exists) return fatalPlan('station_exists', { tile: action.tile });
  plan.stations.push({ kind: action.kind, tile: action.tile, cost: STATIONS[action.kind].cost });
  if (sc.claim) plan.claims.push(action.tile);
  plan.cost = STATIONS[action.kind].cost;
  return plan;
}

export function planAction(world: World, player: PlayerId, action: BuildAction | StationAction): ConstructionPlan {
  return action.type === 'build' ? planBuild(world, player, action) : planStation(world, player, action);
}

// ---------------------------------------------------------------------------
// Executing a slot

export interface SlotEntry {
  player: PlayerId;
  action: Action;
}

function newResult(slot: number, player: PlayerId, action: Action): SlotResult {
  return { slot, player, action, outcome: 'ok', cost: 0, messages: [], built: [], stations: [], lost: [], shared: [], vehicles: [] };
}

function lostTile(world: World, tile: number, owners: PlayerId[]): LostTile {
  const info = world.tile(tile);
  return { tile, owners, turn: info?.turn ?? 0, slot: info?.slot ?? 0 };
}

function stationName(world: World, kind: StationKind, tile: number): string {
  const x = tileX(world.grid, tile);
  const y = tileY(world.grid, tile);
  let place = '';
  let best = Infinity;
  for (const ind of world.state.industries) {
    if (distToRect(x, y, ind.x, ind.y, ind.w, ind.h) > STATIONS[kind].radius) continue;
    const d = Math.hypot(ind.x + ind.w / 2 - x, ind.y + ind.h / 2 - y);
    if (d < best) {
      best = d;
      place = ind.name;
    }
  }
  if (!place) {
    best = Infinity;
    for (const c of world.map.cities) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < best) {
        best = d;
        place = c.name;
      }
    }
  }
  const base = `${STATIONS[kind].prefix} ${place}`.trim();
  const names = new Set(world.state.stations.map((s) => s.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function playerHasSomethingAt(world: World, player: PlayerId, tile: number): boolean {
  const st = world.stationAt.get(tile);
  if (st && st.owners.includes(player)) return true;
  return world.edgesAt(tile).some((e) => e.owners.includes(player));
}

/**
 * Executes the actions of all players in one slot (1-based). Construction happens first
 * (simultaneously, with the shared-tile rule), then vehicle purchases.
 */
export function executeSlot(world: World, slot: number, entries: SlotEntry[]): SlotResult[] {
  const turn = world.state.turn;
  const results: SlotResult[] = [];
  const work: { player: PlayerId; plan: ConstructionPlan; result: SlotResult }[] = [];

  const sorted = [...entries].sort((a, b) => (a.player < b.player ? -1 : a.player > b.player ? 1 : 0));
  for (const { player, action } of sorted) {
    const result = newResult(slot, player, action);
    results.push(result);
    if (action.type === 'vehicles') continue;
    const plan = planAction(world, player, action);
    if (plan.fatal) {
      result.outcome = 'failed';
      result.messages.push(plan.fatal);
      continue;
    }
    const money = world.player(player).money;
    if (plan.cost > money) {
      result.outcome = 'failed';
      result.messages.push({ code: 'insufficient_funds', cost: plan.cost, money });
      continue;
    }
    result.messages.push(...plan.messages);
    result.lost = plan.blocked.map((b) => lostTile(world, b.tile, b.owners));
    work.push({ player, plan, result });
  }

  // 1. Claims. Everyone claiming the same free tile in this slot becomes an owner.
  const claimants = new Map<number, PlayerId[]>();
  for (const w of work) {
    for (const t of w.plan.claims) {
      const list = claimants.get(t);
      if (list) {
        if (!list.includes(w.player)) list.push(w.player);
      } else claimants.set(t, [w.player]);
    }
  }
  // Two different station types can't share a tile: both are refused.
  const stationKinds = new Map<number, Set<StationKind>>();
  for (const w of work) {
    for (const s of w.plan.stations) {
      const set = stationKinds.get(s.tile) ?? new Set<StationKind>();
      set.add(s.kind);
      stationKinds.set(s.tile, set);
    }
  }
  for (const [tile, owners] of claimants) {
    world.setTile(tile, { owners: [...owners].sort(), turn, slot });
  }

  // 2. Build.
  for (const w of work) {
    const { player, plan, result } = w;
    let cost = 0;
    for (const e of plan.edges) {
      const existing = world.edge(e.key);
      if (existing) {
        if (!existing.owners.includes(player)) {
          existing.owners.push(player);
          existing.owners.sort();
        }
      } else {
        world.addEdge(e.key, { kind: e.kind, a: e.a, b: e.b, owners: [player], turn, slot });
      }
      cost += e.cost;
      result.built.push(e.key);
    }
    for (const s of plan.stations) {
      if ((stationKinds.get(s.tile)?.size ?? 0) > 1) {
        result.messages.push({ code: 'station_conflict', tile: s.tile });
        result.lost.push(lostTile(world, s.tile, claimants.get(s.tile)?.filter((p) => p !== player) ?? []));
        continue;
      }
      let station = world.stationAt.get(s.tile);
      if (station) {
        // Built by another player in this very slot: the station is shared.
        if (!station.owners.includes(player)) {
          station.owners.push(player);
          station.owners.sort();
        }
      } else {
        station = {
          id: world.nextId(),
          kind: s.kind,
          tile: s.tile,
          owners: [player],
          name: stationName(world, s.kind, s.tile),
          waiting: [],
          builtTurn: turn,
        };
        world.addStation(station);
        const info = world.tile(s.tile);
        if (info) info.station = station.id;
        else world.setTile(s.tile, { owners: [player], turn, slot, station: station.id });
      }
      cost += s.cost;
      result.stations.push(station.id);
    }
    result.cost = cost;
    world.player(player).money -= cost;
  }

  // 3. Release claimed tiles a claimant ended up not using (e.g. refused station).
  for (const [tile] of claimants) {
    const info = world.tile(tile);
    if (!info) continue;
    info.owners = info.owners.filter((p) => playerHasSomethingAt(world, p, tile));
    if (info.owners.length === 0 && info.station === undefined) world.deleteTile(tile);
  }

  // 4. Outcomes and shared tiles.
  for (const w of work) {
    const { player, plan, result } = w;
    for (const t of plan.claims) {
      const info = world.tile(t);
      if (info && info.owners.length > 1 && info.owners.includes(player)) {
        result.shared.push({ tile: t, with: info.owners.filter((p) => p !== player) });
      }
    }
    const builtSomething = result.built.length > 0 || result.stations.length > 0;
    const stationProblem = plan.messages.some((m) => m.code === 'station_invalid');
    if (result.lost.length > 0 || stationProblem) result.outcome = builtSomething ? 'partial' : 'failed';
  }

  // 5. Vehicles, after this slot's construction.
  for (const result of results) {
    if (result.action.type === 'vehicles') executeVehicles(world, result, result.action);
  }
  return results;
}

function findOrCreateLine(world: World, player: PlayerId, kind: StationKind, a: Station, b: Station): Line {
  const existing = world.state.lines.find(
    (l) =>
      l.owner === player &&
      l.kind === kind &&
      ((l.stations[0] === a.id && l.stations[1] === b.id) || (l.stations[0] === b.id && l.stations[1] === a.id)),
  );
  if (existing) return existing;
  const line: Line = {
    id: world.nextId(),
    owner: player,
    kind,
    stations: [a.id, b.id],
    name: `${a.name} – ${b.name}`,
    createdTurn: world.state.turn,
    length: null,
    stats: { trips: 0, revenue: 0, delivered: {} },
  };
  world.addLine(line);
  return line;
}

function executeVehicles(world: World, result: SlotResult, action: VehicleAction): void {
  const fail = (code: string, extra: Record<string, unknown> = {}) => {
    result.outcome = 'failed';
    result.messages.push({ code, ...extra });
  };
  const player = result.player;
  const model = VEHICLES[action.model];
  if (!model) return fail('invalid_action');
  const from = world.stationAt.get(action.from);
  const to = world.stationAt.get(action.to);
  if (!from) return fail('station_missing', { tile: action.from });
  if (!to) return fail('station_missing', { tile: action.to });
  if (from.id === to.id) return fail('same_station');
  if (from.kind !== model.kind || to.kind !== model.kind) return fail('station_kind', { kind: model.kind });
  if (!from.owners.includes(player) || !to.owners.includes(player)) return fail('station_not_owned');
  const route = findRoute(world, player, model.kind, from.tile, to.tile);
  if (!route) return fail('not_connected');
  const count = Math.max(1, Math.min(MAX_VEHICLES_PER_ACTION, Math.floor(action.count)));
  const cost = model.price * count;
  const money = world.player(player).money;
  if (cost > money) return fail('insufficient_funds', { cost, money });

  const line = findOrCreateLine(world, player, model.kind, from, to);
  const dir: 0 | 1 = line.stations[0] === from.id ? 0 : 1;
  const tripTicks = route.length / (model.speed / TICKS_PER_TURN) + LOAD_TICKS;
  const stagger = Math.max(1, Math.round((2 * tripTicks) / count));
  for (let k = 0; k < count; k++) {
    const vehicle: Vehicle = {
      id: world.nextId(),
      owner: player,
      model: model.id,
      lineId: line.id,
      dir,
      state: 'loading',
      progress: 0,
      wait: LOAD_TICKS + k * stagger,
      cargo: [],
      boughtTurn: world.state.turn,
      stats: { trips: 0, revenue: 0, revenueTotal: 0 },
    };
    world.state.vehicles.push(vehicle);
    result.vehicles.push(vehicle.id);
  }
  world.player(player).money -= cost;
  result.cost = cost;
  result.lineId = line.id;
}
