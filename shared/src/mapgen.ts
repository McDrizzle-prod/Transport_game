// Procedural map generation: relief, sea/lakes, rivers, forests, cities and industries.
import { CITY_CARGO, INDUSTRIES, INDUSTRY_IDS } from './config';
import type { IndustryDef } from './config';
import { STRAIGHT_DIRS, chebyshev, distToRect, inBounds, neighbor, tileX, tileY, toIndex } from './geometry';
import type { Grid } from './geometry';
import { createNoise2D, fbm } from './noise';
import { Rng, hashSeed } from './rng';
import { Terrain, TileUse } from './types';
import type { CargoAmounts, CargoId, City, Industry, IndustryTypeId, MapData } from './types';

export interface GeneratedWorld {
  map: MapData;
  industries: Industry[];
}

const NAME_START = [
  'Al', 'Bra', 'Del', 'Ede', 'Gro', 'Har', 'Lei', 'Mep', 'Ros', 'Ste', 'Vla', 'Wa', 'Zut', 'Ka', 'Lo', 'Ri',
  'Ter', 'Bol', 'Dor', 'Em', 'Hoo', 'Krom', 'Nij', 'Oos', 'Pur', 'Wes', 'Zand', 'Ber', 'Mid', 'Vo',
];
const NAME_END = [
  'berg', 'dam', 'veen', 'hoven', 'dijk', 'wijk', 'horst', 'broek', 'zande', 'loo', 'brug', 'kerk', 'haven',
  'stede', 'mond', 'rade', 'hout', 'voorde', 'sloot', 'werf', 'heim', 'burg',
];
const NAME_PREFIX = ['Nieuw-', 'Oud-', 'Groot-', 'Klein-', 'Sint-'];

function cityName(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let name = rng.pick(NAME_START) + rng.pick(NAME_END);
    if (rng.chance(0.15)) name = rng.pick(NAME_PREFIX) + name;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `Stad ${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

function normalize(values: Float64Array): void {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  for (let i = 0; i < values.length; i++) values[i] = (values[i] - min) / span;
}

/** Flood fill helper: returns connected components of tiles matching `match` (4-neighbour). */
function components(grid: Grid, match: (i: number) => boolean): number[][] {
  const n = grid.width * grid.height;
  const seen = new Uint8Array(n);
  const result: number[][] = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || !match(start)) continue;
    const comp: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const d of STRAIGHT_DIRS) {
        const nb = neighbor(grid, cur, d);
        if (nb >= 0 && !seen[nb] && match(nb)) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    result.push(comp);
  }
  return result;
}

export function generateWorld(seed: number, size: number): GeneratedWorld {
  const W = size;
  const H = size;
  const N = W * H;
  const grid: Grid = { width: W, height: H };
  const rng = new Rng(hashSeed(seed, 'world'));

  // --- Relief -------------------------------------------------------------
  const elevNoise = createNoise2D(hashSeed(seed, 'elevation'));
  const elev = new Float64Array(N);
  const coastSide = rng.int(0, 4); // 0..3: sea along that edge; 4: inland map with lakes
  const featureScale = 22;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let e = fbm(elevNoise, x / featureScale, y / featureScale, 5);
      if (coastSide < 4) {
        const d = [x, y, W - 1 - x, H - 1 - y][coastSide] / size;
        e -= 0.55 * Math.max(0, 1 - d / 0.28) ** 1.6;
      }
      elev[toIndex(grid, x, y)] = e;
    }
  }
  normalize(elev);

  const sorted = Float64Array.from(elev).sort();
  const quantile = (f: number) => sorted[Math.min(N - 1, Math.floor(N * f))];
  const waterLevel = quantile(coastSide < 4 ? 0.15 : 0.1);
  const hillLevel = quantile(0.76);
  const mountainLevel = quantile(0.93);

  const terrain: number[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const e = elev[i];
    terrain[i] = e < waterLevel ? Terrain.Water : e > mountainLevel ? Terrain.Mountain : e > hillLevel ? Terrain.Hills : Terrain.Grass;
  }

  // Remove tiny ponds and islands; they only add noise.
  for (const comp of components(grid, (i) => terrain[i] === Terrain.Water)) {
    if (comp.length < 5) for (const i of comp) terrain[i] = Terrain.Grass;
  }
  for (const comp of components(grid, (i) => terrain[i] !== Terrain.Water)) {
    if (comp.length < 5) for (const i of comp) terrain[i] = Terrain.Water;
  }

  // --- Rivers -------------------------------------------------------------
  const isRiver = new Uint8Array(N);
  const riverCount = Math.max(1, Math.round(size / 30)) + rng.int(0, 1);
  const sources: number[] = [];
  for (let r = 0; r < riverCount; r++) {
    let source = -1;
    for (let attempt = 0; attempt < 300 && source < 0; attempt++) {
      const x = rng.int(4, W - 5);
      const y = rng.int(4, H - 5);
      const i = toIndex(grid, x, y);
      if (terrain[i] !== Terrain.Hills) continue;
      if (sources.some((s) => chebyshev(tileX(grid, s), tileY(grid, s), x, y) < size / 3.5)) continue;
      source = i;
    }
    if (source < 0) continue;
    sources.push(source);

    const path: number[] = [];
    const visited = new Set<number>();
    let cur = source;
    let ended: 'water' | 'edge' | 'stuck' = 'stuck';
    for (let steps = 0; steps < size * 3; steps++) {
      path.push(cur);
      visited.add(cur);
      if (STRAIGHT_DIRS.some((d) => {
        const nb = neighbor(grid, cur, d);
        return nb >= 0 && terrain[nb] === Terrain.Water;
      })) {
        ended = 'water';
        break;
      }
      let next = -1;
      let best = Infinity;
      let atEdge = false;
      for (const d of STRAIGHT_DIRS) {
        const nb = neighbor(grid, cur, d);
        if (nb < 0) {
          atEdge = true;
          continue;
        }
        if (visited.has(nb)) continue;
        const e = elev[nb] + rng.float() * 0.015;
        if (e < best) {
          best = e;
          next = nb;
        }
      }
      if (atEdge && path.length > 4) {
        ended = 'edge';
        break;
      }
      if (next < 0) break;
      cur = next;
    }
    if (path.length < 6) continue;
    for (const i of path) {
      terrain[i] = Terrain.Water;
      isRiver[i] = 1;
      elev[i] = Math.min(elev[i], waterLevel - 0.01);
    }
    if (ended === 'stuck') {
      // The river ends in a small lake.
      const lx = tileX(grid, cur);
      const ly = tileY(grid, cur);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!inBounds(grid, lx + dx, ly + dy)) continue;
          const i = toIndex(grid, lx + dx, ly + dy);
          terrain[i] = Terrain.Water;
          elev[i] = Math.min(elev[i], waterLevel - 0.02);
        }
      }
    }
  }

  // --- Beaches and forests ------------------------------------------------
  const beachLevel = waterLevel + (hillLevel - waterLevel) * 0.12;
  for (let i = 0; i < N; i++) {
    if (terrain[i] !== Terrain.Grass || elev[i] > beachLevel) continue;
    const nearOpenWater = STRAIGHT_DIRS.some((d) => {
      const nb = neighbor(grid, i, d);
      return nb >= 0 && terrain[nb] === Terrain.Water && !isRiver[nb];
    });
    if (nearOpenWater) terrain[i] = Terrain.Sand;
  }

  const forestNoise = createNoise2D(hashSeed(seed, 'forest'));
  const forestValue = new Float64Array(N);
  const forestCandidates: number[] = [];
  for (let i = 0; i < N; i++) {
    forestValue[i] = fbm(forestNoise, tileX(grid, i) / 9, tileY(grid, i) / 9, 3);
    if (terrain[i] === Terrain.Grass || terrain[i] === Terrain.Hills) forestCandidates.push(forestValue[i]);
  }
  forestCandidates.sort((a, b) => a - b);
  const forestThreshold = forestCandidates[Math.floor(forestCandidates.length * 0.72)] ?? 1;
  for (let i = 0; i < N; i++) {
    if ((terrain[i] === Terrain.Grass || terrain[i] === Terrain.Hills) && forestValue[i] > forestThreshold) {
      terrain[i] = Terrain.Forest;
    }
  }

  // --- Cities -------------------------------------------------------------
  const use: number[] = new Array(N).fill(TileUse.None);
  const cities: City[] = [];
  const usedNames = new Set<string>();
  const cityCount = Math.min(10, Math.max(3, Math.round(N / 850)));
  let minCityDist = Math.max(10, Math.floor((size / Math.sqrt(cityCount)) * 0.8));
  const margin = 6;

  while (cities.length < cityCount && minCityDist >= 6) {
    let best = -1;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = rng.int(margin, W - 1 - margin);
      const y = rng.int(margin, H - 1 - margin);
      const i = toIndex(grid, x, y);
      const t = terrain[i];
      if (t !== Terrain.Grass && t !== Terrain.Sand && t !== Terrain.Forest) continue;
      if (cities.some((c) => Math.hypot(c.x - x, c.y - y) < minCityDist)) continue;
      let land = 0;
      let rough = 0;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const tt = terrain[toIndex(grid, x + dx, y + dy)];
          if (tt !== Terrain.Water && tt !== Terrain.Mountain) land++;
          if (tt === Terrain.Hills || tt === Terrain.Mountain) rough++;
        }
      }
      const score = land - rough * 0.6 + rng.float() * 10;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) {
      minCityDist = Math.floor(minCityDist * 0.8);
      continue;
    }
    cities.push(layoutCity(best));
  }

  function layoutCity(center: number): City {
    const cx = tileX(grid, center);
    const cy = tileY(grid, center);
    const radius = rng.pick([3, 4, 4, 5]);
    const tiles: number[] = [];
    let buildings = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > radius + 0.35) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!inBounds(grid, x, y)) continue;
        const i = toIndex(grid, x, y);
        const t = terrain[i];
        if (t === Terrain.Water || t === Terrain.Mountain || use[i] !== TileUse.None) continue;
        const street = dx % 3 === 0 || dy % 3 === 0;
        if (street) {
          use[i] = TileUse.CityStreet;
        } else if (rng.float() < 1 - (d / (radius + 0.5)) ** 2 * 0.7) {
          use[i] = TileUse.CityBuilding;
          buildings++;
        } else {
          continue;
        }
        if (t === Terrain.Forest) terrain[i] = Terrain.Grass;
        tiles.push(i);
      }
    }
    const population = Math.max(300, buildings * rng.int(70, 110));
    const demand: CargoAmounts = {};
    demand.food = Math.min(120, Math.max(20, Math.round(population / 45 / 5) * 5));
    const extras = rng.shuffle(CITY_CARGO.filter((c) => c !== 'food')).slice(0, rng.int(2, 3));
    for (const c of extras) demand[c] = Math.min(80, Math.max(15, Math.round(population / 70 / 5) * 5));
    return { id: cities.length + 1, name: cityName(rng, usedNames), x: cx, y: cy, radius, population, tiles, demand };
  }

  // Every city cargo must be wanted somewhere.
  for (const cargo of CITY_CARGO) {
    if (cities.length === 0 || cities.some((c) => c.demand[cargo])) continue;
    const largest = [...cities].sort((a, b) => b.population - a.population)[0];
    largest.demand[cargo] = Math.min(80, Math.max(15, Math.round(largest.population / 70 / 5) * 5));
  }

  // --- Industries ---------------------------------------------------------
  const industries: Industry[] = [];
  const scale = N / 4096;
  const wanted: IndustryTypeId[] = [];
  const rawTypes = INDUSTRY_IDS.filter((id) => !INDUSTRIES[id].inputs);
  for (const id of INDUSTRY_IDS) {
    const n = Math.max(1, Math.round(INDUSTRIES[id].minCount * scale));
    for (let k = 0; k < n; k++) wanted.push(id);
  }
  const extra = Math.round(4 * scale);
  for (let k = 0; k < extra; k++) wanted.push(rng.pick(rawTypes));
  // Raw industries first: they have the strongest terrain preferences.
  wanted.sort((a, b) => Number(!!INDUSTRIES[a].inputs) - Number(!!INDUSTRIES[b].inputs));

  const usedIndustryNames = new Set<string>();
  for (const type of wanted) {
    const def = INDUSTRIES[type];
    const spot = findIndustrySpot(def);
    if (!spot) continue;
    const [x, y] = spot;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) use[toIndex(grid, x + dx, y + dy)] = TileUse.Industry;
    const nearest = nearestCity(x + 1, y + 1);
    let name = nearest ? `${def.name} ${nearest.name}` : def.name;
    if (usedIndustryNames.has(name)) {
      let n = 2;
      while (usedIndustryNames.has(`${name} ${roman(n)}`)) n++;
      name = `${name} ${roman(n)}`;
    }
    usedIndustryNames.add(name);
    const input: CargoAmounts = {};
    for (const c of Object.keys(def.inputs ?? {}) as CargoId[]) input[c] = 0;
    const rate = rng.pick(def.rates);
    industries.push({
      id: industries.length + 1,
      type,
      name,
      x,
      y,
      w: 2,
      h: 2,
      rate,
      // Raw industries start with one turn of production in stock.
      stock: def.inputs ? 0 : rate,
      input,
      stats: { produced: 0, shipped: 0, received: {} },
      shares: {},
    });
  }

  function nearestCity(x: number, y: number): City | null {
    let best: City | null = null;
    let bestD = Infinity;
    for (const c of cities) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  function findIndustrySpot(def: IndustryDef): [number, number] | null {
    // At least 3 tiles apart, so one station (catchment 1) can't serve two industries: players have to build connections.
    for (const minGap of [5, 4, 3]) {
      let best: [number, number] | null = null;
      let bestScore = -Infinity;
      for (let attempt = 0; attempt < 350; attempt++) {
        const x = rng.int(2, W - 4);
        const y = rng.int(2, H - 4);
        if (!footprintFree(x, y)) continue;
        if (industries.some((o) => rectGap(x, y, 2, 2, o.x, o.y, o.w, o.h) < minGap)) continue;
        if (cities.some((c) => c.tiles.some((t) => distToRect(tileX(grid, t), tileY(grid, t), x, y, 2, 2) < 3))) continue;
        const score = preference(def, x, y) + rng.float() * 3;
        if (score > bestScore) {
          bestScore = score;
          best = [x, y];
        }
      }
      if (best) return best;
    }
    return null;
  }

  function footprintFree(x: number, y: number): boolean {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const i = toIndex(grid, x + dx, y + dy);
        const t = terrain[i];
        if (t === Terrain.Water || t === Terrain.Mountain || use[i] !== TileUse.None) return false;
      }
    }
    return true;
  }

  function preference(def: IndustryDef, x: number, y: number): number {
    let score = 0;
    for (let dy = -2; dy <= 3; dy++) {
      for (let dx = -2; dx <= 3; dx++) {
        if (!inBounds(grid, x + dx, y + dy)) continue;
        const t = terrain[toIndex(grid, x + dx, y + dy)];
        switch (def.terrain) {
          case 'grass':
            score += t === Terrain.Grass ? 1 : t === Terrain.Forest ? -1 : 0;
            break;
          case 'forest':
            score += t === Terrain.Forest ? 1.5 : 0;
            break;
          case 'hills':
            score += t === Terrain.Hills ? 1.5 : t === Terrain.Mountain ? 0.5 : 0;
            break;
          case 'flat':
            score += t === Terrain.Grass || t === Terrain.Sand ? 1 : 0;
            break;
          case 'any':
            break;
        }
      }
    }
    if (def.terrain === 'flat') {
      const c = nearestCity(x + 1, y + 1);
      if (c) score += 10 - Math.abs(Math.hypot(c.x - x, c.y - y) - 10) * 0.6;
    }
    return score;
  }

  const elevation = Array.from(elev, (e) => Math.max(0, Math.min(255, Math.round(e * 255))));
  return {
    map: { width: W, height: H, seed, terrain, elevation, use, cities },
    industries,
  };
}

function rectGap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): number {
  const dx = Math.max(0, bx - (ax + aw - 1), ax - (bx + bw - 1));
  const dy = Math.max(0, by - (ay + ah - 1), ay - (by + bh - 1));
  return Math.max(dx, dy);
}

function roman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);
}
