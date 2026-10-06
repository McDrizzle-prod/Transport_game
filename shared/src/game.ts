// Creating games, joining, placing headquarters and starting.
import { DEFAULT_START_MONEY, MAP_SIZES, MAX_PLAYERS, MIN_HQ_DISTANCE, PLAYER_COLORS, TERRAIN } from './config';
import { chebyshev, tileX, tileY, validTile } from './geometry';
import { generateWorld } from './mapgen';
import { initialMarket } from './market';
import { TileUse } from './types';
import type { GameSettings, GameState, MapData, Msg, Player, PlayerId, TurnSchedule } from './types';

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback;

function isTimeZone(tz: string): boolean {
  if (tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function normalizeSchedule(input: unknown): TurnSchedule {
  const s = (typeof input === 'object' && input ? input : {}) as Record<string, unknown>;
  if (s.mode === 'interval') return { mode: 'interval', minutes: clampInt(s.minutes, 1, 7 * 24 * 60, 60) };
  if (s.mode === 'manual') return { mode: 'manual' };
  const time = typeof s.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) ? s.time : '20:00';
  const timeZone = typeof s.timeZone === 'string' && isTimeZone(s.timeZone) ? s.timeZone : 'Europe/Amsterdam';
  return { mode: 'daily', time, timeZone };
}

export function normalizeSettings(input: Partial<GameSettings> | undefined, randomSeed: number): GameSettings {
  const s = input ?? {};
  const mapSize = (MAP_SIZES as readonly number[]).includes(s.mapSize as number) ? (s.mapSize as number) : 64;
  return {
    mapSize,
    seed: clampInt(s.seed, 0, 2 ** 31 - 1, randomSeed),
    maxPlayers: clampInt(s.maxPlayers, 1, MAX_PLAYERS, 4),
    startMoney: clampInt(s.startMoney, 100_000, 100_000_000, DEFAULT_START_MONEY),
    schedule: normalizeSchedule(s.schedule),
    resolveWhenAllReady: s.resolveWhenAllReady === true,
  };
}

export function createGame(id: string, name: string, settings: GameSettings, now: number): { state: GameState; map: MapData } {
  const { map, industries } = generateWorld(settings.seed, settings.mapSize);
  const state: GameState = {
    id,
    name: name.trim().slice(0, 40) || 'Transportspel',
    createdAt: now,
    phase: 'lobby',
    turn: 1,
    deadline: null,
    lastResolvedAt: null,
    settings,
    players: [],
    industries,
    cityStats: {},
    infra: { tiles: {}, edges: {} },
    stations: [],
    lines: [],
    vehicles: [],
    market: initialMarket(map, industries),
    nextId: 1,
  };
  return { state, map };
}

export function addPlayer(
  state: GameState,
  opts: { id: PlayerId; name: string; color?: string; isHost: boolean; now: number },
): Player | Msg {
  if (state.phase === 'finished') return { code: 'game_finished' };
  if (state.players.length >= state.settings.maxPlayers) return { code: 'game_full' };
  const name = opts.name.trim().slice(0, 24);
  if (!name) return { code: 'name_required' };
  if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return { code: 'name_taken' };
  const taken = new Set(state.players.map((p) => p.color));
  const color =
    opts.color && (PLAYER_COLORS as readonly string[]).includes(opts.color) && !taken.has(opts.color)
      ? opts.color
      : PLAYER_COLORS.find((c) => !taken.has(c)) ?? PLAYER_COLORS[0];
  const player: Player = {
    id: opts.id,
    name,
    color,
    money: state.settings.startMoney,
    hq: null,
    isHost: opts.isHost,
    joinedAt: opts.now,
    last: null,
  };
  state.players.push(player);
  return player;
}

/** Returns why a headquarters can't be placed on `tile`, or null when it can. */
export function hqError(map: MapData, state: GameState, playerId: PlayerId, tile: number): Msg | null {
  const grid = { width: map.width, height: map.height };
  if (!validTile(grid, tile)) return { code: 'hq_invalid' };
  if (!TERRAIN[map.terrain[tile] as keyof typeof TERRAIN].buildable) return { code: 'hq_terrain' };
  if (map.use[tile] !== TileUse.None) return { code: 'hq_occupied' };
  if (state.infra.tiles[tile] || state.stations.some((s) => s.tile === tile)) return { code: 'hq_occupied' };
  const x = tileX(grid, tile);
  const y = tileY(grid, tile);
  for (const p of state.players) {
    if (p.id === playerId || p.hq === null) continue;
    if (chebyshev(x, y, tileX(grid, p.hq), tileY(grid, p.hq)) < MIN_HQ_DISTANCE) return { code: 'hq_too_close', min: MIN_HQ_DISTANCE };
  }
  return null;
}

export function placeHq(map: MapData, state: GameState, playerId: PlayerId, tile: number): Msg | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { code: 'unknown_player' };
  if (state.phase === 'finished') return { code: 'game_finished' };
  // Once the game runs the headquarters is fixed (late joiners place theirs once).
  if (state.phase === 'running' && player.hq !== null) return { code: 'hq_fixed' };
  const error = hqError(map, state, playerId, tile);
  if (error) return error;
  player.hq = tile;
  return null;
}

export function startGame(state: GameState): Msg | null {
  if (state.phase !== 'lobby') return { code: 'already_started' };
  if (!state.players.some((p) => p.hq !== null)) return { code: 'no_hq_placed' };
  state.phase = 'running';
  state.turn = 1;
  return null;
}
