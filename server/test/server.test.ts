import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Terrain, TileUse } from '@transport/shared';
import type { ClientView, JoinResponse, MapData, ServerMessage } from '@transport/shared';
import { createApp } from '../src/app';
import type { App } from '../src/app';
import { nextDeadline, zonedTimeToEpoch } from '../src/schedule';

describe('turn schedule', () => {
  it('finds the next fixed time of day in a time zone, across daylight saving time', () => {
    const summer = Date.UTC(2026, 6, 1, 12, 0); // 1 July 14:00 in Amsterdam
    expect(nextDeadline({ mode: 'daily', time: '20:00', timeZone: 'Europe/Amsterdam' }, summer)).toBe(Date.UTC(2026, 6, 1, 18, 0));
    const winter = Date.UTC(2026, 0, 15, 19, 30); // 15 Jan 20:30 in Amsterdam: already past today
    expect(nextDeadline({ mode: 'daily', time: '20:00', timeZone: 'Europe/Amsterdam' }, winter)).toBe(Date.UTC(2026, 0, 16, 19, 0));
    expect(zonedTimeToEpoch(2026, 3, 29, 12, 0, 'Europe/Amsterdam')).toBe(Date.UTC(2026, 2, 29, 10, 0));
    expect(nextDeadline({ mode: 'interval', minutes: 30 }, 1000)).toBe(1000 + 30 * 60_000);
    expect(nextDeadline({ mode: 'manual' }, 1000)).toBeNull();
  });
});

describe('API', () => {
  let app: App | null = null;
  let base = '';
  let clock = Date.UTC(2026, 6, 1, 12, 0);

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function start(clientDist: string | null = null) {
    clock = Date.UTC(2026, 6, 1, 12, 0);
    app = await createApp({ dataDir: null, clientDist, now: () => clock, tickMs: 50 });
    await new Promise<void>((r) => app!.server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }

  async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; data: T }> {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: (await res.json()) as T };
  }

  function freeTiles(map: MapData, count: number, minGap: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < map.terrain.length && result.length < count; i++) {
      if (map.terrain[i] !== Terrain.Grass || map.use[i] !== TileUse.None) continue;
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      if (result.every((t) => Math.max(Math.abs((t % map.width) - x), Math.abs(Math.floor(t / map.width) - y)) >= minGap)) result.push(i);
    }
    return result;
  }

  /** Two horizontally adjacent free grass tiles that are not one of `avoid`. */
  function freeRoad(map: MapData, avoid: number[]): number[] {
    const free = (t: number) => map.terrain[t] === Terrain.Grass && map.use[t] === TileUse.None && !avoid.includes(t);
    for (let i = 0; i < map.terrain.length - 1; i++) {
      if ((i + 1) % map.width !== 0 && free(i) && free(i + 1)) return [i, i + 1];
    }
    throw new Error('no free tiles');
  }

  it('runs a small game: create, join, place HQs, start, give orders, execute the turn', async () => {
    await start();
    const host = await call<JoinResponse>('POST', '/api/games', {
      name: 'Testspel',
      playerName: 'Anna',
      settings: { mapSize: 48, seed: 3, schedule: { mode: 'daily', time: '20:00', timeZone: 'Europe/Amsterdam' } },
    });
    expect(host.status).toBe(200);
    const gameId = host.data.gameId;
    expect(gameId).toMatch(/^[A-Z0-9]{6}$/);

    const guest = await call<JoinResponse>('POST', `/api/games/${gameId.toLowerCase()}/join`, { name: 'Bram' });
    expect(guest.status).toBe(200);
    expect((await call('POST', `/api/games/${gameId}/join`, { name: 'anna' })).data).toEqual({ error: 'name_taken' });

    const map = (await call<MapData>('GET', `/api/games/${gameId}/map`)).data;
    const [hqA, hqB] = freeTiles(map, 2, 10);
    expect((await call('POST', `/api/games/${gameId}/hq`, { tile: hqA }, host.data.token)).status).toBe(200);
    expect((await call('POST', `/api/games/${gameId}/hq`, { tile: hqB }, guest.data.token)).status).toBe(200);
    expect((await call('POST', `/api/games/${gameId}/start`, {}, guest.data.token)).status).toBe(403);
    expect((await call('POST', `/api/games/${gameId}/start`, {}, host.data.token)).status).toBe(200);

    const view = (await call<ClientView>('GET', `/api/games/${gameId}/view`, undefined, host.data.token)).data;
    expect(view.game.phase).toBe('running');
    expect(view.you?.isHost).toBe(true);
    // Turn executes at 20:00 Amsterdam time = 18:00 UTC in summer.
    expect(view.game.deadline).toBe(Date.UTC(2026, 6, 1, 18, 0));

    // A watches the game over a WebSocket.
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?game=${gameId}&token=${host.data.token}`);
    const messages: ServerMessage[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
    await new Promise((r) => ws.once('open', r));

    // A builds a short road somewhere free.
    const path = freeRoad(map, [hqA, hqB]);
    const ok = await call('PUT', `/api/games/${gameId}/orders`, { slots: [{ type: 'build', kind: 'road', path }], ready: true }, host.data.token);
    expect(ok.status).toBe(200);
    const bad = await call('PUT', `/api/games/${gameId}/orders`, { slots: [{ type: 'build', kind: 'road', path: [0, 99] }], ready: true }, host.data.token);
    expect(bad.status).toBe(400);
    // Orders of others stay secret.
    const guestView = (await call<ClientView>('GET', `/api/games/${gameId}/view`, undefined, guest.data.token)).data;
    expect(guestView.orders?.slots.every((s) => s === null)).toBe(true);
    // ...but everybody can see who is ready (the rejected request changed nothing).
    expect(guestView.ready[host.data.playerId]).toBe(true);

    // The deadline passes: the scheduler executes the turn.
    clock = Date.UTC(2026, 6, 1, 18, 0, 1);
    await new Promise((r) => setTimeout(r, 200));
    const after = (await call<ClientView>('GET', `/api/games/${gameId}/view`, undefined, host.data.token)).data;
    expect(after.game.turn).toBe(2);
    expect(after.lastReportTurn).toBe(1);
    expect(after.game.deadline).toBe(Date.UTC(2026, 6, 2, 18, 0));
    const report = (await call<{ slots: { outcome: string }[] }>('GET', `/api/games/${gameId}/reports/1`)).data;
    expect(report.slots[0].outcome).toBe('ok');
    expect(Object.keys(after.game.infra.tiles).length).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 100));
    const views = messages.filter((m): m is { type: 'view'; view: ClientView } => m.type === 'view');
    expect(views.length).toBeGreaterThan(1);
    expect(views[views.length - 1].view.game.turn).toBe(2);
    ws.close();
  });

  it('forms and leaves alliances through the API', async () => {
    await start();
    const a = await call<JoinResponse>('POST', '/api/games', { name: 'Diplomatie', playerName: 'Anna', settings: { mapSize: 48, seed: 4 } });
    const b = await call<JoinResponse>('POST', `/api/games/${a.data.gameId}/join`, { name: 'Bram' });
    const path = `/api/games/${a.data.gameId}/alliance`;
    expect((await call('POST', path, { action: 'accept', player: a.data.playerId }, b.data.token)).data).toEqual({ error: 'no_invite' });
    expect((await call('POST', path, { action: 'invite', player: b.data.playerId }, a.data.token)).status).toBe(200);
    expect((await call('POST', path, { action: 'accept', player: a.data.playerId }, b.data.token)).status).toBe(200);
    let view = (await call<ClientView>('GET', `/api/games/${a.data.gameId}/view`, undefined, a.data.token)).data;
    expect(view.game.alliances[0].members.sort()).toEqual([a.data.playerId, b.data.playerId].sort());
    expect((await call('POST', path, { action: 'leave' }, b.data.token)).status).toBe(200);
    view = (await call<ClientView>('GET', `/api/games/${a.data.gameId}/view`, undefined, a.data.token)).data;
    expect(view.game.alliances).toHaveLength(0);
    expect((await call('POST', path, { action: 'dance' }, b.data.token)).status).toBe(400);
  });

  it('lets the host execute a turn right away and rejects unknown games', async () => {
    await start();
    const host = await call<JoinResponse>('POST', '/api/games', { name: 'Snel', playerName: 'Host', settings: { mapSize: 48, seed: 9, schedule: { mode: 'manual' } } });
    const { gameId, token } = host.data;
    const map = (await call<MapData>('GET', `/api/games/${gameId}/map`)).data;
    await call('POST', `/api/games/${gameId}/hq`, { tile: freeTiles(map, 1, 1)[0] }, token);
    await call('POST', `/api/games/${gameId}/start`, {}, token);
    expect((await call<ClientView>('GET', `/api/games/${gameId}/view`, undefined, token)).data.game.deadline).toBeNull();
    expect((await call('POST', `/api/games/${gameId}/resolve`, {}, token)).status).toBe(200);
    expect((await call<ClientView>('GET', `/api/games/${gameId}/view`, undefined, token)).data.game.turn).toBe(2);
    expect((await call('GET', '/api/games/NOPE00')).status).toBe(404);
  });

  it('takes loans and places bids as free actions', async () => {
    await start();
    const host = await call<JoinResponse>('POST', '/api/games', {
      name: 'Beurs',
      playerName: 'Host',
      settings: { mapSize: 48, seed: 12, schedule: { mode: 'manual' }, actionSlots: 8 },
    });
    const { gameId, token } = host.data;
    const map = (await call<MapData>('GET', `/api/games/${gameId}/map`)).data;
    await call('POST', `/api/games/${gameId}/hq`, { tile: freeTiles(map, 1, 1)[0] }, token);
    expect((await call('POST', `/api/games/${gameId}/loan`, { action: 'take', amount: 250_000 }, token)).status).toBe(409); // lobby
    await call('POST', `/api/games/${gameId}/start`, {}, token);

    let view = (await call<ClientView>('GET', `/api/games/${gameId}/view`, undefined, token)).data;
    expect(view.game.settings.actionSlots).toBe(8);
    expect(view.orders?.slots).toHaveLength(8);
    const money = view.game.players[0].money;
    expect((await call('POST', `/api/games/${gameId}/loan`, { action: 'take', amount: 250_000 }, token)).status).toBe(200);
    const tooMuch = await call<{ error: string }>('POST', `/api/games/${gameId}/loan`, { action: 'take', amount: 5_000_000 }, token);
    expect(tooMuch.data.error).toBe('loan_limit');
    view = (await call<ClientView>('GET', `/api/games/${gameId}/view`, undefined, token)).data;
    expect(view.game.players[0].debt).toBe(250_000);
    expect(view.game.players[0].money).toBe(money + 250_000);

    // Auctions open after turn 10.
    for (let i = 0; i < 10; i++) await call('POST', `/api/games/${gameId}/resolve`, {}, token);
    view = (await call<ClientView>('GET', `/api/games/${gameId}/view`, undefined, token)).data;
    expect(view.game.turn).toBe(11);
    const auction = view.game.auctions[0];
    expect(auction.status).toBe('open');
    const low = await call<{ error: string; min: number }>('POST', `/api/games/${gameId}/bid`, { auction: auction.id, amount: 1 }, token);
    expect(low.data).toEqual({ error: 'bid_too_low', code: 'bid_too_low', min: auction.minBid });
    expect((await call('POST', `/api/games/${gameId}/bid`, { auction: auction.id, amount: auction.minBid }, token)).status).toBe(200);
    view = (await call<ClientView>('GET', `/api/games/${gameId}/view`, undefined, token)).data;
    expect(view.game.auctions[0].bids).toHaveLength(1);
    expect((await call('POST', `/api/games/${gameId}/bid`, { auction: 'x', amount: 5 }, token)).status).toBe(409);
  });

  it('survives malformed requests', async () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'client-dist-'));
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');
    await start(dist);
    expect((await fetch(`${base}/#/game/X`)).status).toBe(200);
    expect((await fetch(`${base}/api/games/%E0%A4%A`)).status).toBeGreaterThanOrEqual(400);
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(404);
    const bad = await fetch(`${base}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    expect(bad.status).toBe(400);
    // Still alive.
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });
});
