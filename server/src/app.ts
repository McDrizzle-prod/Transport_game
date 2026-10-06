import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createHttpHandler } from './http';
import { GameService } from './service';
import { GameStore } from './store';
import { attachWebSocket } from './ws';

export interface AppOptions {
  /** Directory for game files; null = in memory only. */
  dataDir: string | null;
  /** Built client to serve; null = API only. */
  clientDist: string | null;
  now?: () => number;
  /** How often to check for turns that are due (ms). */
  tickMs?: number;
}

export interface App {
  server: Server;
  service: GameService;
  store: GameStore;
  close(): Promise<void>;
}

export async function createApp(options: AppOptions): Promise<App> {
  const store = new GameStore(options.dataDir);
  await store.load();
  const service = new GameService(store, options.now);
  const handler = createHttpHandler(service, options.clientDist);
  const server = createServer((req, res) => void handler(req, res));
  const ws = attachWebSocket(server, service);
  const ticker = setInterval(() => service.tick(), options.tickMs ?? 1000);
  return {
    server,
    service,
    store,
    async close() {
      clearInterval(ticker);
      ws.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.flush();
    },
  };
}
