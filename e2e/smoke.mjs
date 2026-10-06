// End-to-end smoke test: plays a short game through the real UI and saves screenshots.
//
//   npm run build && npm run e2e
//
// Uses Playwright's Chromium. If it is not installed, point CHROMIUM_PATH to a Chromium/Chrome binary.
// Screenshots end up in e2e/screenshots/.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const shots = path.join(root, 'e2e', 'screenshots');
mkdirSync(shots, { recursive: true });
const PORT = 8800 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;

function log(...args) {
  console.log('[e2e]', ...args);
}

// --- start the server ---------------------------------------------------------
const server = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'server/src/index.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'transportrijk-e2e-')) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
server.stderr.on('data', (d) => process.stderr.write(d));
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function api(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${p}: ${JSON.stringify(data)}`);
  return data;
}

let failed = false;
function check(cond, message) {
  if (cond) log('✓', message);
  else {
    failed = true;
    console.error('[e2e] ✗', message);
  }
}

process.on('exit', () => server.kill());
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  // --- desktop: create a game through the UI -----------------------------------------
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  page.on('pageerror', (e) => {
    failed = true;
    console.error('[e2e] page error:', e.message);
  });
  await page.goto(BASE + '/');
  await page.getByPlaceholder('bv. Rail & Co').fill('Rail & Co');
  await page.getByLabel('Naam van het spel').fill('E2E-spel');
  await page.locator('label.radio', { hasText: 'Alleen als de host' }).locator('input').check();
  await page.locator('summary', { hasText: 'Geavanceerd' }).click();
  await page.getByLabel('Seed (kaart)').fill('42');
  await page.screenshot({ path: path.join(shots, '01-home.png') });
  await page.getByRole('button', { name: 'Spel maken' }).click();
  await page.waitForURL(/#\/game\//);
  const gameId = page.url().split('/').pop();
  log('game', gameId);
  await page.waitForFunction(() => !!window.__transportrijk);
  await page.waitForTimeout(800);

  const map = await api('GET', `/api/games/${gameId}/map`);
  const W = map.width;
  const tileOf = (x, y) => y * W + x;
  const clientPos = (tile) => page.evaluate((t) => window.__transportrijk.tileToClient(t), tile);
  async function clickTile(tile) {
    const [x, y] = await clientPos(tile);
    await page.mouse.click(x, y);
    await page.waitForTimeout(150);
  }
  async function focus(tile) {
    // Centre the camera on a tile by dragging the map.
    const [x, y] = await clientPos(tile);
    const cx = 520;
    const cy = 450;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move((x + cx) / 2, (y + cy) / 2, { steps: 4 });
    await page.mouse.move(cx, cy, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  }

  let view = await api('GET', `/api/games/${gameId}/view`);
  const industries = view.game.industries;
  const free = (t) => map.use[t] === 0 && [1, 2, 3].includes(map.terrain[t]);
  // A farm and a food plant reasonably close to each other.
  const farms = industries.filter((i) => i.type === 'farm');
  const plant = industries.find((i) => i.type === 'food_plant');
  const farm = farms.sort((a, b) => Math.hypot(a.x - plant.x, a.y - plant.y) - Math.hypot(b.x - plant.x, b.y - plant.y))[0];
  const stationNear = (ind, target, avoid = []) => {
    let best = null;
    let bestD = Infinity;
    for (let dy = -2; dy < ind.h + 2; dy++) {
      for (let dx = -2; dx < ind.w + 2; dx++) {
        const x = ind.x + dx;
        const y = ind.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= map.height) continue;
        const t = tileOf(x, y);
        if (!free(t) || avoid.includes(t)) continue;
        const d = Math.hypot(x - target.x, y - target.y);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    return best;
  };
  const stationA = stationNear(farm, plant);
  const stationB = stationNear(plant, farm);
  // Headquarters: a free tile a few tiles away from the farm.
  let hq = null;
  for (let r = 4; r < 12 && hq === null; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
      const x = farm.x + dx;
      const y = farm.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= map.height) continue;
      const t = tileOf(x, y);
      if (free(t) && t !== stationA && t !== stationB) {
        hq = t;
        break;
      }
    }
  }
  log(`farm ${farm.name}, plant ${plant.name}, stations ${stationA} → ${stationB}, hq ${hq}`);

  // Lobby: place the headquarters by tapping the map.
  await focus(hq);
  await clickTile(hq);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shots, '02-lobby-hq.png') });
  view = await api('GET', `/api/games/${gameId}/view`);
  const me = view.game.players[0];
  check(me.hq === hq, 'HQ placed by tapping the map');

  // A second company joins via the API (it will interfere later).
  const rival = await api('POST', `/api/games/${gameId}/join`, { name: 'Konkurrent BV', color: '#1e88e5' });
  let rivalHq = null;
  for (let t = 0; t < map.terrain.length && rivalHq === null; t++) {
    const x = t % W;
    const y = Math.floor(t / W);
    if (free(t) && Math.max(Math.abs(x - (hq % W)), Math.abs(y - Math.floor(hq / W))) > 12 && x > 5 && y > 5) rivalHq = t;
  }
  await api('POST', `/api/games/${gameId}/hq`, { tile: rivalHq }, rival.token);

  await page.getByRole('button', { name: 'Start het spel' }).click();
  await page.waitForTimeout(600);

  // Slot 1: road with stations at both ends.
  await page.getByRole('button', { name: 'Weg' }).click();
  await focus(stationA);
  await clickTile(stationA);
  await clickTile(stationB);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '03-plan-road.png') });
  await page.getByRole('button', { name: /In slot 1/ }).click();
  await page.waitForTimeout(300);

  // Slot 2: trucks between the two (planned) stations.
  await page.getByRole('button', { name: 'Voertuigen' }).click();
  await clickTile(stationA);
  await clickTile(stationB);
  await page.getByRole('button', { name: 'Meer', exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '04-plan-vehicles.png') });
  await page.getByRole('button', { name: /In slot 2/ }).click();
  await page.waitForTimeout(800);

  view = await api('GET', `/api/games/${gameId}/view`, undefined, (await page.evaluate(() => JSON.parse(localStorage.getItem('transportrijk.identities'))[0])).token);
  check(view.orders.slots[0]?.type === 'build' && view.orders.slots[1]?.type === 'vehicles', 'orders saved on the server');
  const roadPath = view.orders.slots[0].path;

  // The rival builds a road straight across ours in slot 1: same slot as our road -> shared tile.
  // Search a spot along our road with free land on both sides.
  const line = (ox, oy, sx, sy) => [-3, -2, -1, 0, 1, 2, 3].map((k) => tileOf(ox + sx * k, oy + sy * k));
  const inMap = (t) => t >= 0 && t < W * map.height;
  let across = null;
  let parallel = null;
  for (let i = 3; i < roadPath.length - 3 && !parallel; i++) {
    const mx = roadPath[i] % W;
    const my = Math.floor(roadPath[i] / W);
    const dx = Math.sign((roadPath[i + 1] % W) - (roadPath[i - 1] % W));
    const dy = Math.sign(Math.floor(roadPath[i + 1] / W) - Math.floor(roadPath[i - 1] / W));
    if (dx !== 0 && dy !== 0) continue;
    const a = line(mx, my, -dy, dx);
    if (!a.every((t) => inMap(t) && (free(t) || roadPath.includes(t)))) continue;
    for (const side of [2, -2]) {
      // Slot 3: a second road of ours, parallel to the first, that crosses the rival's road.
      const p = line(mx - dy * side, my + dx * side, dx, dy);
      if (p.every((t) => inMap(t) && free(t))) {
        across = a;
        parallel = p;
        break;
      }
    }
  }
  const crossing = !!across;
  if (crossing) {
    await api('PUT', `/api/games/${gameId}/orders`, { slots: [{ type: 'build', kind: 'road', path: across }], ready: true }, rival.token);
  }
  if (parallel) {
    await page.getByRole('button', { name: 'Weg' }).click();
    await page.getByText('aan het begin').click();
    await page.getByText('aan het eind').click();
    await clickTile(parallel[0]);
    await clickTile(parallel[parallel.length - 1]);
    await page.getByRole('button', { name: /In slot 3/ }).click();
    await page.waitForTimeout(800);
  } else log('no free room for the conflict scenario, skipping it');

  await page.getByRole('tab', { name: /Acties/ }).click();
  await page.screenshot({ path: path.join(shots, '05-slots.png') });

  // Execute the turn (host button) and watch the replay.
  await page.getByRole('button', { name: /Beurt nu uitvoeren/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Stop afspelen'));
  await page.waitForTimeout(1900);
  await page.screenshot({ path: path.join(shots, '06-replay-construction.png') });
  await page.waitForTimeout(4600);
  await page.screenshot({ path: path.join(shots, '07-replay-vehicles.png') });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(shots, '08-report.png') });

  view = await api('GET', `/api/games/${gameId}/view`);
  check(view.game.turn === 2, 'turn executed');
  check(view.game.vehicles.length === 2, 'two trucks bought');
  const report = await api('GET', `/api/games/${gameId}/reports/1`);
  const mine = report.slots.filter((r) => r.player === me.id);
  check(mine[0]?.outcome !== 'failed' && mine[1]?.outcome === 'ok', `own actions executed (${mine.map((r) => r.outcome).join(', ')})`);
  if (crossing) check(mine[0].shared.length > 0, 'road crossing in the same slot is shared');
  if (parallel) {
    check(mine[2]?.outcome === 'partial' && mine[2].lost.length === 1, `later slot loses the contested tile (${mine[2]?.outcome})`);
  }
  check(report.finances[me.id].revenue > 0, `goods delivered: revenue ${report.finances[me.id].revenue}`);

  await page.getByRole('tab', { name: /Markt/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '09-market.png') });

  // Inspect our station.
  await page.getByRole('button', { name: 'Bekijken' }).click();
  await clickTile(stationA);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '10-info-station.png') });

  // The rival proposes an alliance; we accept it in the players tab.
  await api('POST', `/api/games/${gameId}/alliance`, { action: 'invite', player: me.id }, rival.token);
  await page.getByRole('tab', { name: /Spelers/ }).click();
  await page.getByRole('button', { name: 'Accepteren' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shots, '10b-alliance.png') });
  view = await api('GET', `/api/games/${gameId}/view`);
  check(view.game.alliances.length === 1, 'alliance accepted through the UI');

  // --- phone: the rival opens the game on a small touch screen --------------------------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mobile = await phone.newPage();
  mobile.on('pageerror', (e) => {
    failed = true;
    console.error('[e2e] mobile page error:', e.message);
  });
  await mobile.goto(BASE + '/');
  await mobile.evaluate(
    ([r, id]) =>
      localStorage.setItem('transportrijk.identities', JSON.stringify([{ gameId: id, playerId: r.playerId, token: r.token, name: 'Konkurrent BV', joinedAt: Date.now() }])),
    [rival, gameId],
  );
  await mobile.goto(`${BASE}/#/game/${gameId}`);
  await mobile.waitForTimeout(2500);
  await mobile.screenshot({ path: path.join(shots, '11-mobile-report.png') });
  await mobile.getByRole('tab', { name: /Acties/ }).click();
  await mobile.getByRole('button', { name: 'Spoor' }).click();
  await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: path.join(shots, '12-mobile-rail-tool.png') });
  const sheet = await mobile.locator('.sheet').boundingBox();
  check(!!sheet && sheet.height < 844 * 0.6, 'bottom sheet leaves room for the map on phones');
} finally {
  await browser.close();
  server.kill();
}

log(failed ? 'FAILED' : 'all checks passed', `· screenshots in ${path.relative(process.cwd(), shots)}/`);
process.exit(failed ? 1 : 0);
