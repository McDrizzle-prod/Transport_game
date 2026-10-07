// A GameState plus lookup indexes. Rules operate on a World so they don't have to rebuild indexes.
import type { Grid } from './geometry';
import type { City, Edge, GameState, Industry, Line, MapData, Player, PlayerId, Station, TileInfra } from './types';

export class World {
  readonly map: MapData;
  readonly state: GameState;
  readonly grid: Grid;
  readonly industryAt = new Map<number, Industry>();
  readonly industryById = new Map<number, Industry>();
  readonly cityById = new Map<number, City>();
  readonly hqAt = new Map<number, PlayerId>();
  readonly stationAt = new Map<number, Station>();
  readonly stationById = new Map<number, Station>();
  readonly lineById = new Map<number, Line>();
  private adjacency: Map<number, Edge[]> | null = null;
  private readonly allies = new Map<PlayerId, Set<PlayerId>>();

  constructor(map: MapData, state: GameState) {
    this.map = map;
    this.state = state;
    this.grid = { width: map.width, height: map.height };
    for (const a of state.alliances ?? []) {
      const members = new Set(a.members);
      for (const m of a.members) this.allies.set(m, members);
    }
    for (const ind of state.industries) {
      this.industryById.set(ind.id, ind);
      for (let dy = 0; dy < ind.h; dy++) {
        for (let dx = 0; dx < ind.w; dx++) this.industryAt.set((ind.y + dy) * map.width + ind.x + dx, ind);
      }
    }
    for (const c of map.cities) this.cityById.set(c.id, c);
    for (const p of state.players) if (p.hq !== null) this.hqAt.set(p.hq, p.id);
    for (const s of state.stations) {
      this.stationAt.set(s.tile, s);
      this.stationById.set(s.id, s);
    }
    for (const l of state.lines) this.lineById.set(l.id, l);
  }

  /** May `player` use infrastructure owned by `owners` (own or allied)? */
  canUse(owners: PlayerId[], player: PlayerId): boolean {
    if (owners.includes(player)) return true;
    const allies = this.allies.get(player);
    return !!allies && owners.some((o) => allies.has(o));
  }

  /** Stable text describing the player's alliance (for cache keys). */
  allianceKey(player: PlayerId): string {
    return [...(this.allies.get(player) ?? [])].sort().join(',');
  }

  player(id: PlayerId): Player {
    const p = this.state.players.find((pl) => pl.id === id);
    if (!p) throw new Error(`Unknown player ${id}`);
    return p;
  }

  tile(i: number): TileInfra | undefined {
    return this.state.infra.tiles[i];
  }

  setTile(i: number, info: TileInfra): void {
    this.state.infra.tiles[i] = info;
  }

  deleteTile(i: number): void {
    delete this.state.infra.tiles[i];
  }

  edge(key: string): Edge | undefined {
    return this.state.infra.edges[key];
  }

  /** All edges (any kind, any owner) touching a tile. */
  edgesAt(i: number): Edge[] {
    if (!this.adjacency) {
      this.adjacency = new Map();
      for (const e of Object.values(this.state.infra.edges)) this.index(e);
    }
    return this.adjacency.get(i) ?? [];
  }

  addEdge(key: string, edge: Edge): void {
    this.state.infra.edges[key] = edge;
    if (this.adjacency) this.index(edge);
  }

  addStation(station: Station): void {
    this.state.stations.push(station);
    this.stationAt.set(station.tile, station);
    this.stationById.set(station.id, station);
  }

  addLine(line: Line): void {
    this.state.lines.push(line);
    this.lineById.set(line.id, line);
  }

  nextId(): number {
    return this.state.nextId++;
  }

  private index(e: Edge): void {
    const adj = this.adjacency!;
    for (const t of [e.a, e.b]) {
      const list = adj.get(t);
      if (list) list.push(e);
      else adj.set(t, [e]);
    }
  }
}
