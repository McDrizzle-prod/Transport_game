// Types of the HTTP/WebSocket API shared by server and client.
import type { GamePhase, GameSettings, GameState, PlayerId, PlayerOrders } from './types';

export interface CreateGameRequest {
  name: string;
  playerName: string;
  color?: string;
  /** 4-8 digits: lets the player continue on another device (or via a new link) by name + PIN. */
  pin?: string;
  settings?: Partial<GameSettings>;
}

export interface JoinRequest {
  name: string;
  color?: string;
  /** For a new player: their PIN. For an existing name: the PIN that proves it is them (continue playing). */
  pin?: string;
}

export interface JoinResponse {
  gameId: string;
  playerId: PlayerId;
  token: string;
  /** true when an existing player continued (name + PIN) instead of joining as a new company. */
  rejoined?: boolean;
}

export interface GameSummary {
  id: string;
  name: string;
  phase: GamePhase;
  turn: number;
  maxPlayers: number;
  mapSize: number;
  players: { name: string; color: string; hasHq: boolean }[];
}

/** Everything a client needs to show a game. Orders of other players stay secret. */
export interface ClientView {
  game: GameState;
  you: { playerId: PlayerId; isHost: boolean; hasPin: boolean } | null;
  orders: PlayerOrders | null;
  /** Which players marked their orders as ready. */
  ready: Record<PlayerId, boolean>;
  /** Turn number of the most recent report (fetch it via /reports/:turn), or null. */
  lastReportTurn: number | null;
  serverTime: number;
}

export interface SetOrdersRequest {
  slots: unknown[];
  ready: boolean;
  /** Actions for the next turns; left out = keep the queue as it is. */
  queue?: unknown[];
}

export interface LoanRequest {
  action: 'take' | 'repay';
  amount: number;
}

export interface BidRequest {
  auction: number;
  amount: number;
}

export type ServerMessage = { type: 'view'; view: ClientView } | { type: 'error'; error: string };

export interface ApiErrorBody {
  error: string;
  [key: string]: unknown;
}
