// Transshipment ("overslag"): freight that arrives at a station where nobody wants it is handed over to a
// station within reach (or stays at the same station), from where another line of the player or an ally
// carries it on, until a customer takes it. A truck brings oil to a loading point next to a harbour, a ship
// takes it to another harbour, a train from a station next to that harbour brings it to the refinery.
// The revenue (straight-line distance from the industry to the customer, as always) is paid when the cargo
// reaches the customer and is split over the legs of the journey by their length.
import { CARGO_IDS, STATIONS } from './config';
import { MinHeap, chebyshev, euclid, tileX, tileY } from './geometry';
import type { CargoId, CargoLot, PlayerId, Station } from './types';
import type { World } from './world';

/** Cargo that can be transshipped (passengers only travel directly between two cities). */
export const FREIGHT: CargoId[] = CARGO_IDS.filter((c) => c !== 'passengers');

type Place = Pick<Station, 'kind' | 'tile'>;

/** Do two (planned) stations lie within the reach (radius) of one of them? */
function inReach(world: World, a: Place, b: Place): boolean {
  const g = world.grid;
  const reach = Math.max(STATIONS[a.kind].radius, STATIONS[b.kind].radius);
  return chebyshev(tileX(g, a.tile), tileY(g, a.tile), tileX(g, b.tile), tileY(g, b.tile)) <= reach;
}

/** Can cargo be handed over between two stations: the same station, or within the reach (radius) of one of them? */
export function withinReach(world: World, a: Station, b: Station): boolean {
  return a.id === b.id || inReach(world, a, b);
}

/**
 * Other stations within reach of a station (or of one that is being placed) that `player` may use (own or
 * allied): freight can be handed over between them.
 */
export function transferPartners(world: World, station: Place & { id?: number }, player: PlayerId): Station[] {
  return world.state.stations.filter(
    (s) => s.id !== station.id && s.tile !== station.tile && inReach(world, station, s) && world.canUse(s.owners, player),
  );
}

/** Straight-line distance between two stations (at least 1 tile): the revenue of a journey is split by it. */
export function stationDistance(world: World, a: Station, b: Station): number {
  const g = world.grid;
  return Math.max(1, euclid(tileX(g, a.tile), tileY(g, a.tile), tileX(g, b.tile), tileY(g, b.tile)));
}

/** Stations a lot has already been at: it never travels back to one of them. */
export function visitedStations(lot: Pick<CargoLot, 'legs'>): Set<number> {
  const seen = new Set<number>();
  for (const leg of lot.legs ?? []) {
    seen.add(leg.from);
    seen.add(leg.to);
  }
  return seen;
}

/** A line as the routing sees it: two stations and the length of the route between them. */
export interface RouteLink {
  /** Line id; negative for a line that is only being considered (estimates). */
  line: number;
  owner: PlayerId;
  /** Station ids. */
  a: number;
  b: number;
  length: number;
}

export interface OnwardLeg {
  link: RouteLink;
  from: Station;
  to: Station;
}

/**
 * Where freight can go over the running freight lines of a player and their allies, with transshipment
 * between stations within reach. Cargo never comes back to a station it has been at (`avoid`), so it can't
 * go round in circles; within that, it takes the shortest way to a customer.
 */
export class Routing {
  readonly links: RouteLink[];
  private readonly stations: Station[];
  private readonly linksAt = new Map<number, RouteLink[]>();
  private readonly around = new Map<number, Station[]>();
  private readonly cache = new Map<string, number>();

  constructor(
    private readonly world: World,
    readonly player: PlayerId,
    links: RouteLink[],
    /** Cargo the customers of a station take. */
    readonly accepts: (station: Station) => ReadonlySet<CargoId>,
  ) {
    this.links = links.filter((l) => world.canUse([l.owner], player) && world.stationById.has(l.a) && world.stationById.has(l.b));
    const ids = new Set(this.links.flatMap((l) => [l.a, l.b]));
    this.stations = [...ids].sort((x, y) => x - y).map((id) => world.stationById.get(id)!);
    for (const l of this.links) {
      for (const id of [l.a, l.b]) {
        const list = this.linksAt.get(id);
        if (list) list.push(l);
        else this.linksAt.set(id, [l]);
      }
    }
  }

  /** Where cargo arriving at `station` can be handed over: the station itself first, then the usable stations within reach. */
  candidates(station: Station): Station[] {
    let list = this.around.get(station.id);
    if (!list) {
      list = [
        station,
        ...this.stations.filter((s) => s.id !== station.id && withinReach(this.world, station, s) && this.world.canUse(s.owners, this.player)),
      ];
      this.around.set(station.id, list);
    }
    return list;
  }

  /**
   * Shortest distance to a customer, starting with cargo that just arrived at `start` (it may be taken there,
   * or handed over) or that waits there for a line. Stations in `avoid` are never visited.
   */
  private search(start: Station, waiting: boolean, cargo: CargoId, avoid: ReadonlySet<number>): number {
    const key = `${waiting ? 'w' : 'a'}|${cargo}|${start.id}|${[...avoid].sort((x, y) => x - y).join(',')}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    // States: station id × 2 + 1 while waiting for a line, + 0 just after arriving by vehicle.
    const dist = new Map<number, number>();
    const done = new Set<number>();
    const heap = new MinHeap();
    const first = start.id * 2 + (waiting ? 1 : 0);
    dist.set(first, 0);
    heap.push(first, 0);
    const relax = (state: number, d: number) => {
      if (d < (dist.get(state) ?? Infinity)) {
        dist.set(state, d);
        heap.push(state, d);
      }
    };
    let result = Infinity;
    while (heap.size) {
      const state = heap.pop();
      if (done.has(state)) continue;
      done.add(state);
      const d = dist.get(state)!;
      const id = state >> 1;
      const station = this.world.stationById.get(id)!;
      if ((state & 1) === 0) {
        if (this.accepts(station).has(cargo)) {
          result = d;
          break;
        }
        for (const z of this.candidates(station)) if (z.id === id || !avoid.has(z.id)) relax(z.id * 2 + 1, d);
      } else {
        for (const link of this.linksAt.get(id) ?? []) {
          const other = link.a === id ? link.b : link.a;
          if (other !== id && !avoid.has(other)) relax(other * 2, d + link.length);
        }
      }
    }
    this.cache.set(key, result);
    return result;
  }

  /** Remaining distance for cargo that arrives at `station` by vehicle (0: a customer there takes it); Infinity: no way on. */
  arrive(station: Station, cargo: CargoId, avoid: ReadonlySet<number> = new Set()): number {
    if (this.accepts(station).has(cargo)) return 0;
    return this.search(station, false, cargo, new Set([...avoid, station.id]));
  }

  /** Remaining distance for cargo waiting at `station` (it has to take at least one more line). */
  depart(station: Station, cargo: CargoId, avoid: ReadonlySet<number> = new Set()): number {
    return this.search(station, true, cargo, new Set([...avoid, station.id]));
  }

  /** Where cargo that nobody wants at `station` is handed over to (that station or one within reach), or null. */
  handover(station: Station, cargo: CargoId, avoid: ReadonlySet<number> = new Set()): Station | null {
    const seen = new Set([...avoid, station.id]);
    let best: Station | null = null;
    let bestD = Infinity;
    for (const z of this.candidates(station)) {
      if (z.id !== station.id && seen.has(z.id)) continue;
      const d = this.depart(z, cargo, seen);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  /** The best line for cargo waiting at a station. */
  next(station: Station, cargo: CargoId, avoid: ReadonlySet<number> = new Set()): { link: RouteLink; to: Station } | null {
    const seen = new Set([...avoid, station.id]);
    let best: { link: RouteLink; to: Station } | null = null;
    let bestD = Infinity;
    for (const link of this.linksAt.get(station.id) ?? []) {
      const to = link.a === station.id ? link.b : link.a;
      if (seen.has(to)) continue;
      const toStation = this.world.stationById.get(to)!;
      const d = link.length + this.arrive(toStation, cargo, seen);
      if (d < bestD) {
        bestD = d;
        best = { link, to: toStation };
      }
    }
    return best;
  }

  /** The rest of the journey of cargo arriving at `station`: the lines it takes until a customer takes it. */
  onward(station: Station, cargo: CargoId, visited: ReadonlySet<number> = new Set()): { legs: OnwardLeg[]; end: Station } | null {
    const avoid = new Set(visited);
    const legs: OnwardLeg[] = [];
    let at = station;
    for (let i = 0; i < 16; i++) {
      if (this.accepts(at).has(cargo)) return { legs, end: at };
      avoid.add(at.id);
      const from = this.handover(at, cargo, avoid);
      if (!from) return null;
      avoid.add(from.id);
      const next = this.next(from, cargo, avoid);
      if (!next) return null;
      legs.push({ link: next.link, from, to: next.to });
      at = next.to;
    }
    return null;
  }
}

/** Key for grouping players that share their network (a player and their allies). */
export function routingKey(world: World, player: PlayerId): string {
  return world.allianceKey(player) || player;
}
