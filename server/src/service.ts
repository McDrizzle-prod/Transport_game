// Game operations used by the HTTP API and the turn scheduler.
import { randomBytes, randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  REPORTS_KEPT,
  activePlayers,
  addPlayer,
  createGame,
  emptySlots,
  normalizeSettings,
  placeHq,
  resolveTurn,
  sanitizeOrders,
  startGame,
} from '@transport/shared';
import type {
  ClientView,
  CreateGameRequest,
  GameSummary,
  JoinRequest,
  JoinResponse,
  MapData,
  OrderSlots,
  PlayerId,
  TurnReport,
} from '@transport/shared';
import { nextDeadline } from './schedule';
import type { GameStore, StoredGame } from './store';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class GameService {
  /** Emits 'changed' with the game id whenever something visible changed. */
  readonly events = new EventEmitter();
  private readonly store: GameStore;
  private readonly now: () => number;

  constructor(store: GameStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  exists(id: string): boolean {
    return !!this.store.get(id.toUpperCase());
  }

  createGame(body: CreateGameRequest): JoinResponse {
    if (!body || typeof body !== 'object') throw new ApiError(400, 'invalid_request');
    const playerName = typeof body.playerName === 'string' ? body.playerName : '';
    if (!playerName.trim()) throw new ApiError(400, 'name_required');
    const id = this.newGameId();
    const settings = normalizeSettings(body.settings, randomInt(1, 2 ** 31 - 1));
    const { state, map } = createGame(id, typeof body.name === 'string' ? body.name : '', settings, this.now());
    const game: StoredGame = { version: 1, state, map, tokens: {}, orders: {}, reports: [] };
    const joined = this.addPlayerTo(game, playerName, body.color, true);
    this.store.add(game);
    this.changed(id);
    console.log(`[game ${id}] created by ${playerName} (map ${settings.mapSize}, seed ${settings.seed})`);
    return joined;
  }

  join(id: string, body: JoinRequest): JoinResponse {
    const game = this.game(id);
    const name = typeof body?.name === 'string' ? body.name : '';
    const joined = this.addPlayerTo(game, name, body?.color, false);
    this.changed(game.state.id);
    return joined;
  }

  summary(id: string): GameSummary {
    const { state } = this.game(id);
    return {
      id: state.id,
      name: state.name,
      phase: state.phase,
      turn: state.turn,
      maxPlayers: state.settings.maxPlayers,
      mapSize: state.settings.mapSize,
      players: state.players.map((p) => ({ name: p.name, color: p.color, hasHq: p.hq !== null })),
    };
  }

  map(id: string): MapData {
    return this.game(id).map;
  }

  view(id: string, token: string | null): ClientView {
    const game = this.game(id);
    const playerId = this.playerFor(game, token);
    const player = playerId ? game.state.players.find((p) => p.id === playerId) : undefined;
    return {
      game: game.state,
      you: player ? { playerId: player.id, isHost: player.isHost } : null,
      orders: player ? (game.orders[player.id] ?? { slots: emptySlots(), ready: false, updatedAt: 0 }) : null,
      ready: Object.fromEntries(game.state.players.map((p) => [p.id, game.orders[p.id]?.ready ?? false])),
      lastReportTurn: game.reports.length ? game.reports[game.reports.length - 1].turn : null,
      serverTime: this.now(),
    };
  }

  report(id: string, turn: number): TurnReport {
    const report = this.game(id).reports.find((r) => r.turn === turn);
    if (!report) throw new ApiError(404, 'report_not_found');
    return report;
  }

  placeHq(id: string, token: string | null, tile: unknown): void {
    const game = this.game(id);
    const playerId = this.requirePlayer(game, token);
    if (typeof tile !== 'number' || !Number.isInteger(tile)) throw new ApiError(400, 'invalid_tile');
    const error = placeHq(game.map, game.state, playerId, tile);
    if (error) throw new ApiError(400, error.code, error);
    this.changed(game.state.id);
  }

  start(id: string, token: string | null): void {
    const game = this.game(id);
    this.requireHost(game, token);
    const error = startGame(game.state);
    if (error) throw new ApiError(409, error.code);
    game.state.deadline = nextDeadline(game.state.settings.schedule, this.now());
    this.changed(game.state.id);
    console.log(`[game ${game.state.id}] started with ${game.state.players.length} player(s)`);
  }

  setOrders(id: string, token: string | null, body: { slots?: unknown; ready?: unknown }): void {
    const game = this.game(id);
    const playerId = this.requirePlayer(game, token);
    if (game.state.phase !== 'running') throw new ApiError(409, 'not_running');
    const player = game.state.players.find((p) => p.id === playerId)!;
    if (player.hq === null) throw new ApiError(409, 'no_hq');
    const result = sanitizeOrders(game.map, body?.slots);
    if (!result.ok) throw new ApiError(400, result.error);
    game.orders[playerId] = { slots: result.slots, ready: body?.ready === true, updatedAt: this.now() };
    this.changed(game.state.id);
  }

  /** Host-triggered execution of the current turn (handy for testing and casual games). */
  resolveNow(id: string, token: string | null): void {
    const game = this.game(id);
    this.requireHost(game, token);
    if (game.state.phase !== 'running') throw new ApiError(409, 'not_running');
    this.resolve(game);
  }

  /** Called every second: executes turns whose deadline passed (or when everybody is ready). */
  tick(): void {
    const now = this.now();
    for (const game of this.store.all()) {
      if (game.state.phase !== 'running') continue;
      if (this.isDue(game, now)) this.resolve(game);
    }
  }

  private isDue(game: StoredGame, now: number): boolean {
    const { state } = game;
    if (state.deadline !== null && now >= state.deadline) return true;
    if (!state.settings.resolveWhenAllReady) return false;
    const active = activePlayers(state);
    return active.length > 0 && active.every((p) => game.orders[p]?.ready);
  }

  private resolve(game: StoredGame): void {
    const now = this.now();
    const id = game.state.id;
    const orders: Record<PlayerId, OrderSlots> = {};
    for (const [player, o] of Object.entries(game.orders)) orders[player] = o.slots;
    try {
      const started = performance.now();
      const { state, report } = resolveTurn(game.map, game.state, orders, now);
      state.deadline = nextDeadline(state.settings.schedule, now);
      game.state = state;
      game.reports.push(report);
      if (game.reports.length > REPORTS_KEPT) game.reports.splice(0, game.reports.length - REPORTS_KEPT);
      game.orders = {};
      console.log(`[game ${id}] turn ${report.turn} executed in ${(performance.now() - started).toFixed(0)} ms`);
    } catch (err) {
      // Never retry a crashing turn in a tight loop: try again in 5 minutes.
      console.error(`[game ${id}] turn resolution failed:`, err);
      game.state.deadline = now + 5 * 60_000;
    }
    this.changed(id);
  }

  private addPlayerTo(game: StoredGame, name: string, color: string | undefined, isHost: boolean): JoinResponse {
    const playerId = `p_${randomBytes(6).toString('hex')}`;
    const result = addPlayer(game.state, { id: playerId, name, color, isHost, now: this.now() });
    if ('code' in result) throw new ApiError(400, result.code);
    const token = randomBytes(24).toString('base64url');
    game.tokens[playerId] = token;
    return { gameId: game.state.id, playerId, token };
  }

  private newGameId(): string {
    for (;;) {
      let id = '';
      for (let i = 0; i < 6; i++) id += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.store.get(id)) return id;
    }
  }

  private game(id: string): StoredGame {
    const game = this.store.get(String(id).toUpperCase());
    if (!game) throw new ApiError(404, 'game_not_found');
    return game;
  }

  private playerFor(game: StoredGame, token: string | null): PlayerId | null {
    if (!token) return null;
    for (const [playerId, t] of Object.entries(game.tokens)) if (t === token) return playerId;
    return null;
  }

  private requirePlayer(game: StoredGame, token: string | null): PlayerId {
    const playerId = this.playerFor(game, token);
    if (!playerId) throw new ApiError(401, 'unauthorized');
    return playerId;
  }

  private requireHost(game: StoredGame, token: string | null): PlayerId {
    const playerId = this.requirePlayer(game, token);
    if (!game.state.players.find((p) => p.id === playerId)?.isHost) throw new ApiError(403, 'host_only');
    return playerId;
  }

  private changed(id: string): void {
    this.store.markDirty(id);
    this.events.emit('changed', id);
  }
}
