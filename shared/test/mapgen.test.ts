import { describe, expect, it } from 'vitest';
import { INDUSTRY_IDS, Terrain, TileUse, addPlayer, createGame, generateWorld, hqError, normalizeSettings, placeHq, startGame } from '../src';

describe('map generation', () => {
  it('is deterministic for a seed', () => {
    const a = generateWorld(1234, 48);
    const b = generateWorld(1234, 48);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.industries).toEqual(b.industries);
    expect(generateWorld(1235, 48).map.terrain).not.toEqual(a.map.terrain);
  });

  it.each([11, 42, 99, 2024])('creates a playable 64×64 map (seed %i)', (seed) => {
    const { map, industries } = generateWorld(seed, 64);
    expect(map.terrain).toHaveLength(64 * 64);
    expect(map.cities.length).toBeGreaterThanOrEqual(3);
    // Every industry type exists, so every production chain can be completed.
    const types = new Set(industries.map((i) => i.type));
    for (const id of INDUSTRY_IDS) expect(types.has(id)).toBe(true);
    for (const ind of industries) {
      for (let dy = 0; dy < ind.h; dy++) {
        for (let dx = 0; dx < ind.w; dx++) {
          const t = (ind.y + dy) * 64 + ind.x + dx;
          expect(map.use[t]).toBe(TileUse.Industry);
          expect(map.terrain[t]).not.toBe(Terrain.Water);
        }
      }
    }
    const water = map.terrain.filter((t) => t === Terrain.Water).length;
    expect(water).toBeGreaterThan(64 * 64 * 0.05);
    expect(water).toBeLessThan(64 * 64 * 0.35);
  });
});

describe('game setup', () => {
  it('places headquarters with a minimum distance and starts the game', () => {
    const { state, map } = createGame('G1', 'Test', normalizeSettings({ mapSize: 48, seed: 5 }, 5), 0);
    addPlayer(state, { id: 'p1', name: 'Anna', isHost: true, now: 0 });
    addPlayer(state, { id: 'p2', name: 'Bram', isHost: false, now: 0 });
    expect(addPlayer(state, { id: 'p3', name: 'anna', isHost: false, now: 0 })).toEqual({ code: 'name_taken' });
    expect(state.players[0].color).not.toBe(state.players[1].color);

    const free = map.terrain.findIndex((t, i) => t === Terrain.Grass && map.use[i] === TileUse.None);
    expect(placeHq(map, state, 'p1', free)).toBeNull();
    expect(hqError(map, state, 'p2', free + 1)?.code).toBe('hq_too_close');
    const water = map.terrain.findIndex((t) => t === Terrain.Water);
    expect(hqError(map, state, 'p2', water)?.code).toBe('hq_terrain');

    expect(startGame(state)).toBeNull();
    expect(state.phase).toBe('running');
    // After the start the headquarters can't be moved anymore.
    expect(placeHq(map, state, 'p1', free + 20)?.code).toBe('hq_fixed');
  });
});
