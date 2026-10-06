// Types of the HTTP/WebSocket API shared by server and client.
import type { GamePhase, GameSettings, GameState, PlayerId, PlayerOrders } from './types';

export interface CreateGameRequest {
  name: string;
  playerName: string;
  color?: string;
  settings?: Partial<GameSettings>;
}

export interface JoinRequest {
  name: string;
  color?: string;
}

export interface JoinResponse {
  gameId: string;
  playerId: PlayerId;
  token: string;
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
  you: { playerId: PlayerId; isHost: boolean } | null;
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
}

export type ServerMessage = { type: 'view'; view: ClientView } | { type: 'error'; error: string };

export interface ApiErrorBody {
  error: string;
  [key: string]: unknown;
}
