// Game operations used by the HTTP API and the turn scheduler.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  REPORTS_KEPT,
  World,
  acceptAlliance,
  activePlayers,
  declineAlliance,
  inviteToAlliance,
  leaveAlliance,
  addPlayer,
  createGame,
  emptySlots,
  normalizeSettings,
  placeBid,
  placeHq,
  repayLoan,
  resolveTurn,
  sanitizeOrders,
  sanitizeQueue,
  startGame,
  takeFromQueue,
  takeLoan,
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
/** Wrong PINs allowed per player name before a pause, and how long that pause lasts. */
const PIN_ATTEMPTS = 5;
const PIN_LOCK_MS = 10 * 60_000;

const validPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{4,8}$/.test(pin);

function hashPin(pin: string, salt = randomBytes(8).toString('hex')): string {
  return `${salt}:${createHash('sha256').update(`${salt}:${pin}`).digest('hex')}`;
}

function pinMatches(pin: string, stored: string): boolean {
  const [salt] = stored.split(':');
  const a = Buffer.from(hashPin(pin, salt));
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class GameService {
  /** Emits 'changed' with the game id whenever something visible changed. */
  readonly events = new EventEmitter();
  private readonly store: GameStore;
  private readonly now: () => number;
  /** Wrong PIN attempts per game + player name. */
  private readonly pinFailures = new Map<string, { count: number; until: number }>();

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
    const game: StoredGame = { version: 1, state, map, tokens: {}, pins: {}, orders: {}, reports: [] };
    if (body.pin !== undefined && !validPin(body.pin)) throw new ApiError(400, 'pin_invalid');
    const joined = this.addPlayerTo(game, playerName, body.color, true, body.pin);
    this.store.add(game);
    this.changed(id);
    console.log(`[game ${id}] created by ${playerName} (map ${settings.mapSize}, seed ${settings.seed})`);
    return joined;
  }

  /** Join as a new company, or continue as an existing one with its name + PIN (another device, a new link). */
  join(id: string, body: JoinRequest): JoinResponse {
    const game = this.game(id);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const pin = body?.pin;
    if (pin !== undefined && !validPin(pin)) throw new ApiError(400, 'pin_invalid');
    const existing = game.state.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      const stored = game.pins?.[existing.id];
      if (!stored) throw new ApiError(409, 'name_taken');
      const key = `${game.state.id}:${existing.id}`;
      const failures = this.pinFailures.get(key);
      if (failures && failures.count >= PIN_ATTEMPTS && this.now() < failures.until) throw new ApiError(429, 'too_many_attempts');
      if (!pin || !pinMatches(pin, stored)) {
        const count = failures && this.now() < failures.until ? failures.count + 1 : 1;
        this.pinFailures.set(key, { count, until: this.now() + PIN_LOCK_MS });
        throw new ApiError(403, pin ? 'pin_wrong' : 'name_taken_pin');
      }
      this.pinFailures.delete(key);
      return { gameId: game.state.id, playerId: existing.id, token: game.tokens[existing.id], rejoined: true };
    }
    const joined = this.addPlayerTo(game, name, body?.color, false, pin);
    this.changed(game.state.id);
    return joined;
  }

  /** Set or change the player's PIN. */
  setPin(id: string, token: string | null, body: { pin?: unknown }): void {
    const game = this.game(id);
    const playerId = this.requirePlayer(game, token);
    if (!validPin(body?.pin)) throw new ApiError(400, 'pin_invalid');
    (game.pins ??= {})[playerId] = hashPin(body.pin);
    this.changed(game.state.id);
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
      you: player ? { playerId: player.id, isHost: player.isHost, hasPin: !!game.pins?.[player.id] } : null,
      orders: player
        ? { queue: [], ...(game.orders[player.id] ?? { slots: emptySlots(game.state.settings.actionSlots), ready: false, updatedAt: 0 }) }
        : null,
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

  setOrders(id: string, token: string | null, body: { slots?: unknown; ready?: unknown; queue?: unknown }): void {
    const game = this.game(id);
    const playerId = this.requirePlayer(game, token);
    if (game.state.phase !== 'running') throw new ApiError(409, 'not_running');
    const player = game.state.players.find((p) => p.id === playerId)!;
    if (player.hq === null) throw new ApiError(409, 'no_hq');
    const result = sanitizeOrders(game.map, body?.slots, game.state.settings.actionSlots);
    if (!result.ok) throw new ApiError(400, result.error);
    let queue = game.orders[playerId]?.queue ?? [];
    if (body?.queue !== undefined) {
      const q = sanitizeQueue(game.map, body.queue);
      if (!q.ok) throw new ApiError(400, q.error);
      queue = q.queue;
    }
    game.orders[playerId] = { slots: result.slots, queue, ready: body?.ready === true, updatedAt: this.now() };
    this.changed(game.state.id);
  }

  /** Alliance diplomacy: invite / accept / decline / leave. Takes effect immediately. */
  alliance(id: string, token: string | null, body: { action?: unknown; player?: unknown }): void {
    const game = this.game(id);
    const playerId = this.requirePlayer(game, token);
    const other = typeof body?.player === 'string' ? body.player : '';
    const state = game.state;
    let error;
    switch (body?.action) {
      case 'invite':
        error = inviteToAlliance(state, playerId, other, this.now());
        break;
      case 'accept':
        error = acceptAlliance(state, playerId, other);
        break;
      case 'decline':
        error = declineAlliance(state, playerId, other);
        break;
      case 'leave':
        error = leaveAlliance(state, playerId);
        break;
      default:
        throw new ApiError(400, 'invalid_request');
    }
    if (error) throw new ApiError(409, error.code);
    this.changed(game.state.id);
  }

  /** Take or repay a loan: a free action that takes effect immediately. */
  loan(id: string, token: string | null, body: { action?: unknown; amount?: unknown }): void {
    const game = this.game(id);
    const playerId = this.requirePlayer(game, token);
    const amount = typeof body?.amount === 'number' ? body.amount : NaN;
    const world = new World(game.map, game.state);
    let error;
    if (body?.action === 'take') error = takeLoan(world, playerId, amount);
    else if (body?.action === 'repay') error = repayLoan(world, playerId, amount);
    else throw new ApiError(400, 'invalid_request');
    if (error) throw new ApiError(409, error.code, error);
    this.changed(game.state.id);
  }

  /** Bid on a share auction: a free action; the money is reserved until somebody bids more. */
  bid(id: string, token: string | null, body: { auction?: unknown; amount?: unknown }): void {
    const game = this.game(id);
    const playerId = this.requirePlayer(game, token);
    const auction = typeof body?.auction === 'number' ? body.auction : NaN;
    const amount = typeof body?.amount === 'number' ? body.amount : NaN;
    const error = placeBid(game.state, playerId, auction, amount, this.now());
    if (error) throw new ApiError(409, error.code, error);
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
      // Queued actions (e.g. the rest of a long route) fill the slots of the new turn.
      const next: StoredGame['orders'] = {};
      for (const [player, o] of Object.entries(game.orders)) {
        if (!o.queue?.length) continue;
        next[player] = { ...takeFromQueue(o.queue, state.settings.actionSlots), ready: false, updatedAt: now };
      }
      game.orders = next;
      console.log(`[game ${id}] turn ${report.turn} executed in ${(performance.now() - started).toFixed(0)} ms`);
    } catch (err) {
      // Never retry a crashing turn in a tight loop: try again in 5 minutes.
      console.error(`[game ${id}] turn resolution failed:`, err);
      game.state.deadline = now + 5 * 60_000;
    }
    this.changed(id);
  }

  private addPlayerTo(game: StoredGame, name: string, color: string | undefined, isHost: boolean, pin?: string): JoinResponse {
    const playerId = `p_${randomBytes(6).toString('hex')}`;
    const result = addPlayer(game.state, { id: playerId, name, color, isHost, now: this.now() });
    if ('code' in result) throw new ApiError(400, result.code);
    if (pin) (game.pins ??= {})[playerId] = hashPin(pin);
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
