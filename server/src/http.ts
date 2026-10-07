// Minimal JSON API router + static file server for the built client.
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { ApiError } from './service';
import type { GameService } from './service';

interface Ctx {
  params: Record<string, string>;
  body: unknown;
  token: string | null;
  url: URL;
}

type Handler = (ctx: Ctx) => unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  cache?: string;
}

function route(method: string, pathPattern: string, handler: Handler, cache?: string): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${pathPattern.replace(/:(\w+)/g, (_, key: string) => {
      keys.push(key);
      return '([^/]+)';
    })}$`,
  );
  return { method, pattern, keys, handler, cache };
}

const MAX_BODY = 1024 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new ApiError(413, 'too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError(400, 'invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, data: unknown, cache = 'no-store'): void {
  const raw = Buffer.from(JSON.stringify(data ?? { ok: true }));
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache };
  const gzip = raw.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  const payload = gzip ? gzipSync(raw) : raw;
  if (gzip) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = String(payload.length);
  res.writeHead(status, headers);
  res.end(payload);
}

function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL, dist: string): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!existsSync(dist)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return false; // malformed escape sequence: 404
  }
  let file = path.normalize(path.join(dist, decoded));
  if (!file.startsWith(path.normalize(dist + path.sep)) && file !== path.normalize(dist)) return false;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Single page app: unknown paths get index.html (but missing assets stay 404).
    if (path.extname(url.pathname)) return false;
    file = path.join(dist, 'index.html');
    if (!existsSync(file)) return false;
  }
  const ext = path.extname(file);
  const immutable = url.pathname.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}

export function createHttpHandler(service: GameService, clientDist: string | null) {
  const num = (s: string) => Number.parseInt(s, 10);
  const routes: Route[] = [
    route('GET', '/api/health', () => ({ ok: true })),
    route('POST', '/api/games', ({ body }) => service.createGame(body as never)),
    route('GET', '/api/games/:id', ({ params }) => service.summary(params.id)),
    route('POST', '/api/games/:id/join', ({ params, body }) => service.join(params.id, body as never)),
    route('GET', '/api/games/:id/map', ({ params }) => service.map(params.id), 'public, max-age=86400, immutable'),
    route('GET', '/api/games/:id/view', ({ params, token }) => service.view(params.id, token)),
    route('GET', '/api/games/:id/reports/:turn', ({ params }) => service.report(params.id, num(params.turn))),
    route('POST', '/api/games/:id/hq', ({ params, token, body }) => service.placeHq(params.id, token, (body as { tile?: unknown })?.tile)),
    route('POST', '/api/games/:id/start', ({ params, token }) => service.start(params.id, token)),
    route('PUT', '/api/games/:id/orders', ({ params, token, body }) => service.setOrders(params.id, token, body as never)),
    route('POST', '/api/games/:id/resolve', ({ params, token }) => service.resolveNow(params.id, token)),
    route('POST', '/api/games/:id/alliance', ({ params, token, body }) => service.alliance(params.id, token, body as never)),
    route('POST', '/api/games/:id/loan', ({ params, token, body }) => service.loan(params.id, token, body as never)),
    route('POST', '/api/games/:id/bid', ({ params, token, body }) => service.bid(params.id, token, body as never)),
  ];

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // The API uses bearer tokens (no cookies), so allowing other origins is safe and lets native app wrappers connect.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = r.pattern.exec(url.pathname);
          if (!m) continue;
          const params: Record<string, string> = {};
          r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
          const auth = String(req.headers.authorization ?? '');
          const token = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token');
          const body = req.method === 'GET' ? undefined : await readBody(req);
          const result = await r.handler({ params, body, token, url });
          sendJson(req, res, 200, result ?? { ok: true }, r.cache);
          return;
        }
        throw new ApiError(404, 'not_found');
      } catch (err) {
        if (err instanceof ApiError) {
          sendJson(req, res, err.status, { ...err.extra, error: err.code });
        } else {
          console.error('[http] unexpected error', err);
          sendJson(req, res, 500, { error: 'internal' });
        }
      }
      return;
    }

    if (clientDist && serveStatic(req, res, url, clientDist)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(clientDist && existsSync(clientDist) ? 'Not found' : 'Client not built. Run "npm run build" or use "npm run dev".');
  };

  // Never let a single bad request take the whole server down.
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await handle(req, res);
    } catch (err) {
      console.error('[http] request failed', err);
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
    }
  };
}
