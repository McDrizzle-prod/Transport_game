// WebSocket push: every client watching a game gets its own (personalised) view whenever the game changes.
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerMessage } from '@transport/shared';
import type { GameService } from './service';

interface Subscriber {
  ws: WebSocket;
  token: string | null;
  alive: boolean;
}

export function attachWebSocket(server: Server, service: GameService): { close(): void } {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: { threshold: 1024 } });
  const subscribers = new Map<string, Set<Subscriber>>();
  const pending = new Set<string>();

  const send = (sub: Subscriber, gameId: string) => {
    if (sub.ws.readyState !== WebSocket.OPEN) return;
    let msg: ServerMessage;
    try {
      msg = { type: 'view', view: service.view(gameId, sub.token) };
    } catch {
      msg = { type: 'error', error: 'game_not_found' };
    }
    sub.ws.send(JSON.stringify(msg));
  };

  server.on('upgrade', (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    const gameId = url.searchParams.get('game')?.toUpperCase() ?? '';
    if (url.pathname !== '/ws' || !service.exists(gameId)) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const sub: Subscriber = { ws, token: url.searchParams.get('token'), alive: true };
      let set = subscribers.get(gameId);
      if (!set) subscribers.set(gameId, (set = new Set()));
      set.add(sub);
      ws.on('pong', () => (sub.alive = true));
      ws.on('close', () => set!.delete(sub));
      ws.on('error', () => ws.terminate());
      send(sub, gameId);
    });
  });

  // Coalesce bursts of changes into one push per game.
  service.events.on('changed', (gameId: string) => {
    if (pending.has(gameId)) return;
    pending.add(gameId);
    setTimeout(() => {
      pending.delete(gameId);
      for (const sub of subscribers.get(gameId) ?? []) send(sub, gameId);
    }, 30);
  });

  const heartbeat = setInterval(() => {
    for (const set of subscribers.values()) {
      for (const sub of set) {
        if (!sub.alive) {
          sub.ws.terminate();
          set.delete(sub);
          continue;
        }
        sub.alive = false;
        sub.ws.ping();
      }
    }
  }, 30_000);

  return {
    close() {
      clearInterval(heartbeat);
      for (const set of subscribers.values()) for (const sub of set) sub.ws.terminate();
      wss.close();
    },
  };
}
