import type {
  ClientView,
  CreateGameRequest,
  GameSummary,
  JoinRequest,
  JoinResponse,
  MapData,
  OrderSlots,
  ServerMessage,
  TurnReport,
} from '@transport/shared';

/** Server base URL. Empty = same origin (browser). Set VITE_API_URL when the app is wrapped natively. */
const BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const { error, ...extra } = data;
    throw new ApiError(res.status, typeof error === 'string' ? error : 'internal', extra);
  }
  return data as T;
}

export const api = {
  createGame: (req: CreateGameRequest) => call<JoinResponse>('POST', '/api/games', req),
  summary: (id: string) => call<GameSummary>('GET', `/api/games/${id}`),
  join: (id: string, req: JoinRequest) => call<JoinResponse>('POST', `/api/games/${id}/join`, req),
  map: (id: string) => call<MapData>('GET', `/api/games/${id}/map`),
  view: (id: string, token: string | null) => call<ClientView>('GET', `/api/games/${id}/view`, undefined, token),
  report: (id: string, turn: number) => call<TurnReport>('GET', `/api/games/${id}/reports/${turn}`),
  placeHq: (id: string, token: string, tile: number) => call('POST', `/api/games/${id}/hq`, { tile }, token),
  start: (id: string, token: string) => call('POST', `/api/games/${id}/start`, {}, token),
  setOrders: (id: string, token: string, slots: OrderSlots, ready: boolean) =>
    call('PUT', `/api/games/${id}/orders`, { slots, ready }, token),
  resolve: (id: string, token: string) => call('POST', `/api/games/${id}/resolve`, {}, token),
};

function wsUrl(gameId: string, token: string | null): string {
  const base = BASE || window.location.origin;
  const url = new URL('/ws', base.replace(/^http/, 'ws'));
  url.searchParams.set('game', gameId);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

/** Keeps a WebSocket open (reconnecting with back-off) and reports every pushed view. */
export function connectGame(
  gameId: string,
  token: string | null,
  onView: (view: ClientView) => void,
  onStatus: (status: 'connecting' | 'online' | 'offline') => void,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: number | undefined;

  const open = () => {
    if (closed) return;
    onStatus('connecting');
    ws = new WebSocket(wsUrl(gameId, token));
    ws.onopen = () => {
      attempt = 0;
      onStatus('online');
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        if (msg.type === 'view') onView(msg.view);
      } catch {
        // ignore malformed messages
      }
    };
    ws.onclose = () => {
      if (closed) return;
      onStatus('offline');
      attempt++;
      timer = window.setTimeout(open, Math.min(15_000, 500 * 2 ** attempt));
    };
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible' && ws?.readyState !== WebSocket.OPEN && !closed) {
      window.clearTimeout(timer);
      ws?.close();
      open();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  open();

  return () => {
    closed = true;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    ws?.close();
  };
}
