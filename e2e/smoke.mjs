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
  await page.getByLabel('Acties per beurt').selectOption('20');
  await page.locator('label.radio', { hasText: 'Alleen als de host' }).locator('input').check();
  await page.locator('summary', { hasText: 'Geavanceerd' }).click();
  await page.getByLabel('Seed (kaart)').fill('65');
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
  const xy = (t) => [t % W, Math.floor(t / W)];
  const clientPos = (tile) => page.evaluate((t) => window.__transportrijk.tileToClient(t), tile);
  async function clickTile(tile) {
    const [x, y] = await clientPos(tile);
    await page.mouse.click(x, y);
    await page.waitForTimeout(150);
  }
  async function focus(tile) {
    // Centre the camera on a tile (same as tapping an item in a list).
    await page.evaluate((t) => window.__transportrijk.focus(t), tile);
    await page.waitForTimeout(600);
  }
  const identity = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('transportrijk.identities'))[0])).token;
  /** Orders are saved shortly after a change; wait until the server has them. */
  const saved = async () => {
    await page.waitForTimeout(100);
    await page.waitForSelector('.sync.saved', { timeout: 5000 });
  };

  let view = await api('GET', `/api/games/${gameId}/view`);
  check(view.game.settings.actionSlots === 20, 'game created with 20 actions per turn');
  const industries = view.game.industries;
  // Free land, not too close to the edge of the map (where the camera can't centre it under the top bar).
  const free = (t) => {
    const x = t % W;
    const y = Math.floor(t / W);
    return x >= 6 && y >= 6 && x < W - 6 && y < map.height - 6 && map.use[t] === 0 && [1, 2, 3].includes(map.terrain[t]);
  };
  // Station tiles right next to an industry (the catchment area is one tile).
  const around = (ind) => {
    const tiles = [];
    for (let dy = -1; dy <= ind.h; dy++) {
      for (let dx = -1; dx <= ind.w; dx++) {
        const x = ind.x + dx;
        const y = ind.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= map.height) continue;
        if (free(tileOf(x, y))) tiles.push(tileOf(x, y));
      }
    }
    return tiles;
  };
  // The closest pair of a raw industry and the factory that wants its cargo, with open land in between
  // (room for the conflict scenario below).
  const chains = { farm: 'food_plant', forest: 'sawmill', coal_mine: 'steel_mill', iron_mine: 'steel_mill', oil_well: 'refinery', quarry: 'cm_plant' };
  const openLine = (a, b) => {
    const [ax, ay] = xy(a);
    const [bx, by] = xy(b);
    const n = Math.max(Math.abs(ax - bx), Math.abs(ay - by));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(ax + ((bx - ax) * k) / n);
      const y = Math.round(ay + ((by - ay) * k) / n);
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (!free(tileOf(x + dx, y + dy)) && k > 0 && k < n) return false;
    }
    return true;
  };
  let best = null;
  for (const src of industries.filter((i) => chains[i.type])) {
    for (const dst of industries.filter((i) => i.type === chains[src.type])) {
      for (const a of around(src)) {
        for (const b of around(dst)) {
          const [ax, ay] = xy(a);
          const [bx, by] = xy(b);
          const d = Math.max(Math.abs(ax - bx), Math.abs(ay - by));
          // Mostly horizontal or vertical: the road gets a straight stretch.
          const straight = Math.min(Math.abs(ax - bx), Math.abs(ay - by)) <= 2;
          if (d >= 8 && d <= 14 && straight && (!best || d < best.d) && openLine(a, b)) best = { src, dst, a, b, d };
        }
      }
    }
  }
  const { src, dst, a: stationA, b: stationB } = best;
  // Headquarters: a free tile a few tiles away from the source industry (so the line earns the HQ bonus).
  let hq = null;
  for (let r = 3; r < 12 && hq === null; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) {
      const x = src.x + dx;
      const y = src.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= map.height) continue;
      const t = tileOf(x, y);
      if (free(t) && t !== stationA && t !== stationB) {
        hq = t;
        break;
      }
    }
  }
  log(`${src.name} → ${dst.name}: stations ${stationA} → ${stationB} (${best.d} tiles), hq ${hq}`);

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
    const [x, y] = xy(t);
    const [hx, hy] = xy(hq);
    if (free(t) && Math.max(Math.abs(x - hx), Math.abs(y - hy)) > 12 && x > 5 && y > 5) rivalHq = t;
  }
  await api('POST', `/api/games/${gameId}/hq`, { tile: rivalHq }, rival.token);

  await page.getByRole('button', { name: 'Start het spel' }).click();
  await page.waitForTimeout(600);

  // A road with stations at both ends: tap the start, then the end. It goes straight into the slots.
  await page.getByRole('button', { name: 'Weg' }).click();
  await page.getByText('aan het begin').click();
  await page.getByText('aan het eind').click();
  await focus(stationA);
  await clickTile(stationA);
  const [ex, ey] = await clientPos(stationB);
  await page.mouse.move(ex, ey);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '03-plan-road.png') });
  await page.mouse.click(ex, ey);
  await page.waitForTimeout(400);
  check((await page.getByRole('button', { name: 'Bekijken' }).getAttribute('aria-pressed')) === 'true', 'route tool closes after the second tap');
  await saved();

  view = await api('GET', `/api/games/${gameId}/view`, undefined, await identity());
  const planned = view.orders.slots.filter(Boolean);
  const segments = planned.filter((a) => a.type === 'build');
  check(
    planned[0]?.type === 'station' && planned[planned.length - 1]?.type === 'station' && segments.every((a) => a.path.length === 2),
    `road planned as ${segments.length} one-tile actions between two station actions`,
  );
  const roadPath = [segments[0].path[0], ...segments.map((a) => a.path[1])];

  // Trucks: tap the first station, then next to the second one (taps snap to a station nearby).
  await page.getByRole('button', { name: 'Voertuigen' }).click();
  await clickTile(stationA);
  const [bx, by] = xy(stationB);
  const nearB = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => tileOf(bx + dx, by + dy)).find((t) => !roadPath.includes(t)) ?? stationB;
  await clickTile(nearB);
  await page.getByRole('button', { name: 'Meer', exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '04-plan-vehicles.png') });
  const vehicleSlot = planned.length + 1;
  await page.getByRole('button', { name: new RegExp(`In slot ${vehicleSlot}`) }).click();
  await saved();

  view = await api('GET', `/api/games/${gameId}/view`, undefined, await identity());
  check(view.orders.slots[vehicleSlot - 1]?.type === 'vehicles' && view.orders.slots[vehicleSlot - 1].to === stationB, 'vehicles planned (tap next to a station selects it)');

  // Conflicts. The rival builds a road straight across ours, one segment per slot. The segment that reaches
  // our road does so in the same slot as ours: that tile is shared. Then we plan a second, parallel road in
  // later slots; the rival claimed the crossing tile earlier, so that part of our road fails.
  const line = (ox, oy, sx, sy) => [-3, -2, -1, 0, 1, 2, 3].map((k) => tileOf(ox + sx * k, oy + sy * k));
  const inMap = (t) => t >= 0 && t < W * map.height;
  let across = null;
  let parallel = null;
  let at = -1;
  let side = 0;
  for (let i = 3; i < roadPath.length - 3 && !parallel; i++) {
    const [mx, my] = xy(roadPath[i]);
    const dx = Math.sign((roadPath[i + 1] % W) - (roadPath[i - 1] % W));
    const dy = Math.sign(Math.floor(roadPath[i + 1] / W) - Math.floor(roadPath[i - 1] / W));
    if (dx !== 0 && dy !== 0) continue;
    const a = line(mx, my, -dy, dx);
    if (!a.every((t) => inMap(t) && (free(t) || roadPath.includes(t))) || a.filter((t) => roadPath.includes(t)).length !== 1) continue;
    for (const s of [2, -2]) {
      const p = line(mx - dy * s, my + dx * s, dx, dy);
      // Flat land only, so the planner takes the straight line.
      if (p.every((t) => inMap(t) && free(t) && map.terrain[t] !== 3 && !roadPath.includes(t))) {
        across = a;
        parallel = p;
        at = i;
        side = s;
        break;
      }
    }
  }
  if (across) {
    // Our road reaches roadPath[at] with segment at-1, which is in slot at+1 (slot 1 is the station).
    const order = side > 0 ? [[2, 3], [3, 4], [4, 5], [5, 6], [1, 2], [0, 1]] : [[4, 3], [3, 2], [2, 1], [1, 0], [5, 4], [6, 5]];
    const slots = Array.from({ length: 20 }, () => null);
    order.forEach(([u, v], k) => (slots[at + k] = { type: 'build', kind: 'road', path: [across[u], across[v]] }));
    await api('PUT', `/api/games/${gameId}/orders`, { slots, ready: true }, rival.token);

    await page.getByRole('button', { name: 'Weg' }).click();
    await clickTile(parallel[0]);
    await clickTile(parallel[parallel.length - 1]);
    await saved();
  } else log('no free room for the conflict scenario, skipping it');

  // Free actions: take a loan in the exchange tab.
  await page.getByRole('tab', { name: /Beurs/ }).click();
  await page.getByRole('button', { name: /^Leen/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shots, '05a-exchange.png') });
  view = await api('GET', `/api/games/${gameId}/view`);
  check(view.game.players[0].debt === 250_000, 'loan taken without using an action');

  await page.getByRole('tab', { name: /Acties/ }).click();
  await page.screenshot({ path: path.join(shots, '05-slots.png') });

  // Execute the turn (host button) and watch the replay.
  await page.getByRole('button', { name: /Beurt nu uitvoeren/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Stop afspelen'));
  // The build phase takes at most 6 seconds; just before its end all conflicts are marked.
  await page.waitForTimeout(5600);
  await page.screenshot({ path: path.join(shots, '06-replay-construction.png') });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(shots, '07-replay-vehicles.png') });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(shots, '08-report.png') });

  view = await api('GET', `/api/games/${gameId}/view`);
  check(view.game.turn === 2, 'turn executed');
  check(view.game.vehicles.length === 2, 'two trucks bought');
  const report = await api('GET', `/api/games/${gameId}/reports/1`);
  const mine = report.slots.filter((r) => r.player === me.id);
  const vehicles = mine.find((r) => r.action.type === 'vehicles');
  check(vehicles?.outcome === 'ok', `vehicles bought in slot ${vehicles?.slot}`);
  check(mine.filter((r) => r.slot < vehicleSlot).every((r) => r.outcome === 'ok'), 'road and stations built');
  if (across) {
    const sharedTile = roadPath[at];
    check(mine.some((r) => r.shared.some((sh) => sh.tile === sharedTile)), 'a tile claimed by both players in the same slot is shared');
    const lostTile = parallel[3];
    check(
      mine.some((r) => r.slot > vehicleSlot && r.outcome === 'failed' && r.lost.some((l) => l.tile === lostTile)),
      'our later segment loses the tile the rival claimed in an earlier slot',
    );
  }
  check(report.finances[me.id].revenue > 0, `goods delivered: revenue ${report.finances[me.id].revenue}`);
  check(report.finances[me.id].interest === 5000, 'interest charged on the loan');

  await page.getByRole('tab', { name: /Markt/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '09-market.png') });

  // Inspect our station and the nearest city.
  await page.getByRole('button', { name: 'Bekijken' }).click();
  await clickTile(stationA);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '10-info-station.png') });
  const city = map.cities[0];
  await focus(tileOf(city.x, city.y));
  await clickTile(tileOf(city.x, city.y));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '10a-info-city.png') });
  check((await page.locator('.sheet').innerText()).includes('passagiers'), 'city info explains passengers');

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
