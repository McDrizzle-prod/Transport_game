// Builds small hand-made worlds so rules can be tested precisely.
import { INDUSTRIES, Terrain, TileUse, initialMarket, normalizeSettings } from '../src';
import type { Action, CargoAmounts, City, GameState, Industry, IndustryTypeId, MapData, OrderSlots } from '../src';

export interface TestWorld {
  map: MapData;
  state: GameState;
  at: (x: number, y: number) => number;
}

export function makeWorld(opts: {
  width: number;
  height: number;
  players?: string[];
  water?: (x: number, y: number) => boolean;
  money?: number;
}): TestWorld {
  const { width, height } = opts;
  const n = width * height;
  const terrain: number[] = new Array(n).fill(Terrain.Grass);
  if (opts.water) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (opts.water(x, y)) terrain[y * width + x] = Terrain.Water;
  }
  const map: MapData = {
    width,
    height,
    seed: 1,
    terrain,
    elevation: new Array(n).fill(128),
    use: new Array(n).fill(TileUse.None),
    cities: [],
  };
  const settings = normalizeSettings({ mapSize: 64, seed: 7, startMoney: opts.money ?? 1_000_000 }, 7);
  const state: GameState = {
    id: 'TEST',
    name: 'Test',
    createdAt: 0,
    phase: 'running',
    turn: 1,
    deadline: null,
    lastResolvedAt: null,
    settings,
    players: [],
    industries: [],
    cityStats: {},
    infra: { tiles: {}, edges: {} },
    stations: [],
    lines: [],
    vehicles: [],
    market: initialMarket(map, []),
    nextId: 1,
  };
  (opts.players ?? ['A', 'B']).forEach((id, k) => {
    state.players.push({
      id,
      name: id,
      color: '#000',
      money: settings.startMoney,
      hq: (height - 1) * width + k * 8, // bottom row, out of the way
      isHost: k === 0,
      joinedAt: 0,
      last: null,
    });
  });
  return { map, state, at: (x, y) => y * width + x };
}

export function addIndustry(w: TestWorld, type: IndustryTypeId, x: number, y: number, rate?: number, stock = 0): Industry {
  const def = INDUSTRIES[type];
  const input: Industry['input'] = {};
  for (const c of Object.keys(def.inputs ?? {})) input[c as keyof typeof input] = 0;
  const ind: Industry = {
    id: w.state.industries.length + 1,
    type,
    name: `${def.name} ${w.state.industries.length + 1}`,
    x,
    y,
    w: 2,
    h: 2,
    rate: rate ?? def.rates[0],
    stock,
    input,
    stats: { produced: 0, shipped: 0, received: {} },
  };
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) w.map.use[w.at(x + dx, y + dy)] = TileUse.Industry;
  w.state.industries.push(ind);
  w.state.market = initialMarket(w.map, w.state.industries);
  return ind;
}

export function addCity(w: TestWorld, x: number, y: number, demand: CargoAmounts): City {
  const tiles: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = w.at(x + dx, y + dy);
      w.map.use[t] = dx === 0 || dy === 0 ? TileUse.CityStreet : TileUse.CityBuilding;
      tiles.push(t);
    }
  }
  const city: City = { id: w.map.cities.length + 1, name: `Stad ${w.map.cities.length + 1}`, x, y, radius: 1, population: 1000, tiles, demand };
  w.map.cities.push(city);
  w.state.market = initialMarket(w.map, w.state.industries);
  return city;
}

/** Straight horizontal path of tiles from (x0, y) to (x1, y). */
export function hPath(w: TestWorld, x0: number, x1: number, y: number): number[] {
  const path: number[] = [];
  const step = x1 >= x0 ? 1 : -1;
  for (let x = x0; x !== x1 + step; x += step) path.push(w.at(x, y));
  return path;
}

/** Straight vertical path of tiles from (x, y0) to (x, y1). */
export function vPath(w: TestWorld, x: number, y0: number, y1: number): number[] {
  const path: number[] = [];
  const step = y1 >= y0 ? 1 : -1;
  for (let y = y0; y !== y1 + step; y += step) path.push(w.at(x, y));
  return path;
}

export function slots(...actions: (Action | null)[]): OrderSlots {
  const s: OrderSlots = [null, null, null, null, null];
  actions.forEach((a, i) => (s[i] = a));
  return s;
}
