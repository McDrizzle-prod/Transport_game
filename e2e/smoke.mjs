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
  // New visitors land on joining; creating a game is one click further.
  check(await page.getByRole('heading', { name: 'Meedoen met een spel' }).isVisible(), 'the start screen opens with joining a game');
  await page.screenshot({ path: path.join(shots, '00-landing.png') });
  await page.getByRole('button', { name: /Nieuw spel maken/ }).click();
  await page.getByPlaceholder('bv. Rail & Co').fill('Rail & Co');
  await page.locator('.card', { hasText: 'Nieuw spel' }).getByLabel(/pincode/i).fill('1234');
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

  // A road between the tiles next to the two loading points: tap A, tap B, check the preview, tap ✓.
  // It goes into the free slots, one action per tile.
  const towards = (from, to) => {
    const [fx, fy] = xy(from);
    const [tx, ty] = xy(to);
    return tileOf(fx + Math.sign(tx - fx), fy + Math.sign(ty - fy));
  };
  const roadStart = towards(stationA, stationB);
  const roadEnd = towards(stationB, stationA);
  await page.getByRole('button', { name: 'Weg' }).click();
  await focus(roadStart);
  await clickTile(roadStart);
  const [ex, ey] = await clientPos(roadEnd);
  await page.mouse.move(ex, ey);
  await page.waitForTimeout(300);
  await page.mouse.click(ex, ey);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '03-plan-road.png') });
  check((await page.getByRole('button', { name: 'Weg' }).getAttribute('aria-pressed')) === 'true', 'after A and B the route waits for the check mark');
  await page.getByRole('button', { name: 'Route plannen' }).click();
  await page.waitForTimeout(300);
  check((await page.getByRole('button', { name: 'Bekijken' }).getAttribute('aria-pressed')) === 'true', 'the check mark plans the route and closes the tool');
  await saved();

  view = await api('GET', `/api/games/${gameId}/view`, undefined, await identity());
  const segments = view.orders.slots.filter(Boolean);
  const [sx0, sy0] = xy(roadStart);
  const [ex0, ey0] = xy(roadEnd);
  check(
    segments.every((a) => a.type === 'build' && a.path.length === 2) && segments.length === Math.max(Math.abs(ex0 - sx0), Math.abs(ey0 - sy0)),
    `straight road planned as ${segments.length} one-tile actions`,
  );
  const roadPath = [segments[0].path[0], ...segments.map((a) => a.path[1])];

  // Loading points beside both ends of the road, with the station tool (it starts with a loading point).
  for (const tile of [stationA, stationB]) {
    await page.getByRole('button', { name: 'Station' }).click();
    await clickTile(tile);
    const panel = await page.locator('.tool-panel').innerText();
    check(panel.includes('Laadpunt') && panel.includes('Sluit aan op je weg'), `loading point next to the road is connected (${tile})`);
    await page.locator('.tool-panel').getByRole('button', { name: /In slot/ }).click();
    await saved();
  }

  // A station within reach of another one can hand freight over (transshipment); the tool says so.
  {
    const [ax, ay] = xy(stationA);
    const nextToA = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
      .map(([dx, dy]) => tileOf(ax + dx, ay + dy))
      .find((t) => free(t) && !roadPath.includes(t));
    if (nextToA !== undefined) {
      await page.getByRole('button', { name: 'Station' }).click();
      await clickTile(nextToA);
      check((await page.locator('.tool-panel').innerText()).includes('Overslag met'), 'a station next to another one offers transshipment');
      await page.locator('.tool-panel').getByRole('button', { name: 'Annuleren' }).click();
    }
  }

  // A picked vehicle only fits its own kind of station.
  await page.getByRole('button', { name: 'Voertuigen' }).click();
  await page.locator('.model', { hasText: 'Stoomtrein' }).click();
  await clickTile(stationA);
  check((await page.locator('.toast').innerText()).includes('laadpunt'), 'a train refuses a loading point with an explanation');

  // Trucks: pick the truck, tap the first loading point, then next to the second one (taps snap to it).
  await page.locator('.model', { hasText: 'Vrachtwagen' }).first().click();
  await clickTile(stationA);
  const [bx, by] = xy(stationB);
  const nearB = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => tileOf(bx + dx, by + dy)).find((t) => !roadPath.includes(t)) ?? stationB;
  await clickTile(nearB);
  await page.getByRole('button', { name: 'Meer', exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, '04-plan-vehicles.png') });
  check(!(await page.locator('.tool-panel').innerText()).includes('niet verbonden'), 'the loading points are connected by the road');
  const planned = segments.length + 2;
  const vehicleSlot = planned + 1;
  await page.getByRole('button', { name: new RegExp(`In slot ${vehicleSlot}`) }).click();
  await saved();

  view = await api('GET', `/api/games/${gameId}/view`, undefined, await identity());
  check(view.orders.slots[vehicleSlot - 1]?.type === 'vehicles' && view.orders.slots[vehicleSlot - 1].to === stationB, 'vehicles planned (tap next to a station selects it)');
  const ourSlots = view.orders.slots;

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
    // The rival reaches roadPath[at] in the same slot as our segment that claims it.
    const claim = ourSlots.findIndex((a) => a?.type === 'build' && a.path[1] === roadPath[at]);
    const order = side > 0 ? [[2, 3], [3, 4], [4, 5], [5, 6], [1, 2], [0, 1]] : [[4, 3], [3, 2], [2, 1], [1, 0], [5, 4], [6, 5]];
    const slots = Array.from({ length: 20 }, () => null);
    order.forEach(([u, v], k) => (slots[claim + k] = { type: 'build', kind: 'road', path: [across[u], across[v]] }));
    await api('PUT', `/api/games/${gameId}/orders`, { slots, ready: true }, rival.token);

    await page.getByRole('button', { name: 'Weg' }).click();
    await clickTile(parallel[0]);
    await clickTile(parallel[parallel.length - 1]);
    await page.getByRole('button', { name: 'Route plannen' }).click();
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

  // More points make bends; the route runs exactly through every point. A tap on the route goes back to it.
  view = await api('GET', `/api/games/${gameId}/view`);
  const taken = (t) => !!view.game.infra.tiles[t] || view.game.stations.some((st) => st.tile === t) || view.game.players.some((p) => p.hq === t);
  let corner = null;
  const [hqx, hqy] = xy(hq);
  for (let r = 2; r < 14 && corner === null; r++) {
    for (const [dx, dy] of [[r, -r], [-r, -r], [r, r], [-r, r], [r, 0], [0, r], [-r, 0], [0, -r]]) {
      const x0 = hqx + dx;
      const y0 = hqy + dy;
      const area = [];
      for (let y = y0; y <= y0 + 3; y++) for (let x = x0; x <= x0 + 3; x++) area.push(tileOf(x, y));
      if (area.every((t) => free(t) && !taken(t))) {
        corner = [x0, y0];
        break;
      }
    }
  }
  if (corner) {
    const [x0, y0] = corner;
    await page.getByRole('tab', { name: /Acties/ }).click();
    await page.getByRole('button', { name: 'Weg' }).click();
    await focus(tileOf(x0 + 2, y0 + 2));
    for (const [dx, dy] of [[0, 0], [3, 0]]) await clickTile(tileOf(x0 + dx, y0 + dy));
    // After A and B the route is locked: a stray tap (e.g. just beside the ✓) changes nothing.
    await clickTile(tileOf(x0 + 3, y0 + 3));
    check((await page.evaluate(() => window.__transportrijk.route())).length === 4, 'after A and B a tap on the map does not change the route');
    // ＋ adds one more point (a bend).
    await page.getByRole('button', { name: 'Punt toevoegen' }).click();
    await clickTile(tileOf(x0 + 3, y0 + 3));
    const drawn = await page.evaluate(() => window.__transportrijk.route());
    const expected = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [3, 3]].map(([dx, dy]) => tileOf(x0 + dx, y0 + dy));
    check(JSON.stringify(drawn) === JSON.stringify(expected), 'with ＋ the route runs exactly through the extra point');
    // While adding a point, the mouse shows the next piece dashed.
    await page.getByRole('button', { name: 'Punt toevoegen' }).click();
    const [gx, gy] = await clientPos(tileOf(x0, y0 + 3));
    await page.mouse.move(gx, gy);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(shots, '10c-route-points.png') });
    await clickTile(tileOf(x0 + 3, y0 + 1));
    check((await page.evaluate(() => window.__transportrijk.route())).length === 5, 'with ＋, a tap on the route takes it back to that tile');
    await page.getByRole('button', { name: 'Laatste punt terug' }).click();
    check((await page.evaluate(() => window.__transportrijk.route())).length === 4, 'the undo button takes the last point back');
    await page.getByRole('button', { name: 'Annuleren' }).click();
  } else log('no free area to draw in, skipping that check');

  // Auctions: after turn 10 three run at the same time; a share we win glows green on the map.
  const myToken = await identity();
  for (let turn = view.game.turn; turn <= 10; turn++) await api('POST', `/api/games/${gameId}/resolve`, {}, myToken);
  view = await api('GET', `/api/games/${gameId}/view`);
  let open = view.game.auctions.filter((a) => a.status === 'open');
  check(view.game.turn === 11 && open.length === 3, `three auctions open in turn ${view.game.turn} (${open.length})`);
  const won = open[0];
  await api('POST', `/api/games/${gameId}/bid`, { auction: won.id, amount: won.minBid }, myToken);
  await api('POST', `/api/games/${gameId}/resolve`, {}, myToken);
  await api('POST', `/api/games/${gameId}/resolve`, {}, myToken);
  view = await api('GET', `/api/games/${gameId}/view`);
  open = view.game.auctions.filter((a) => a.status === 'open');
  const share = view.game.industries.find((i) => i.id === won.industry);
  check(share.shares[me.id] === 1 && open.length === 3, 'share won; a new auction took its place');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape'); // stop the replay
  await page.getByRole('tab', { name: /Beurs/ }).click();
  await page.locator('.auction .link').first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(shots, '13-auction-flash.png') });
  await focus(tileOf(share.x, share.y));
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(shots, '14-share-glow.png') });

  // The queue: a route that doesn't fit in this turn's slots continues in the next turns by itself.
  view = await api('GET', `/api/games/${gameId}/view`);
  const occupied = (t) => !!view.game.infra.tiles[t] || view.game.stations.some((st) => st.tile === t) || view.game.players.some((p) => p.hq === t);
  let row = null;
  for (let r = 2; r < 16 && !row; r++) {
    for (const [ox, oy] of [[r, 0], [-r - 6, 0], [0, r], [0, -r], [r, r], [-r - 6, -r], [-r - 6, r], [r, -r]]) {
      const cand = [0, 1, 2, 3, 4, 5, 6].map((dx) => tileOf(hqx + ox + dx, hqy + oy));
      if (cand.every((t) => free(t) && !occupied(t))) {
        row = cand;
        break;
      }
    }
  }
  if (row) {
    // 17 of the 20 slots are already used (actions that will simply fail).
    const filler = Array.from({ length: 17 }, () => ({ type: 'sell', line: 999999, count: 1 }));
    await api('PUT', `/api/games/${gameId}/orders`, { slots: [...filler, null, null, null], ready: false }, myToken);
    await page.waitForTimeout(700);
    await page.getByRole('tab', { name: /Acties/ }).click();
    await page.getByRole('button', { name: 'Weg' }).click();
    await focus(row[3]);
    await clickTile(row[0]);
    await clickTile(row[6]);
    check((await page.locator('.route-bar').innerText()).includes('naar wachtrij'), 'the route bar says what goes to the queue');
    await page.getByRole('button', { name: 'Route plannen' }).click();
    await saved();
    view = await api('GET', `/api/games/${gameId}/view`, undefined, myToken);
    check(view.orders.slots.filter(Boolean).length === 20 && view.orders.queue?.length === 3, `3 segments this turn, 3 in the queue (${view.orders.queue?.length})`);
    const queuePanel = page.locator('.queue');
    await queuePanel.scrollIntoViewIfNeeded();
    check((await queuePanel.innerText()).includes(`B${view.game.turn + 1}`), 'the queue shows the turn it is for');
    await page.screenshot({ path: path.join(shots, '17-queue.png') });
    // Edit: free two slots and pull the queue forward.
    await page.locator('.slot', { hasText: 'verkopen' }).first().getByRole('button', { name: 'Verwijderen' }).click();
    await page.locator('.slot', { hasText: 'verkopen' }).first().getByRole('button', { name: 'Verwijderen' }).click();
    await page.getByRole('button', { name: /naar deze beurt/ }).click();
    await saved();
    view = await api('GET', `/api/games/${gameId}/view`, undefined, myToken);
    check(view.orders.queue?.length === 1, 'two queued actions pulled into the freed slots');
    const queued = view.orders.queue[0];
    await api('POST', `/api/games/${gameId}/resolve`, {}, myToken);
    await page.waitForTimeout(800);
    view = await api('GET', `/api/games/${gameId}/view`, undefined, myToken);
    check(JSON.stringify(view.orders.slots[0]) === JSON.stringify(queued) && view.orders.queue.length === 0, 'after the turn the queued action is in slot 1');
    await page.keyboard.press('Escape');
  } else log('no room for the queue check');

  // --- a friend opens the game link (from the address bar) on a phone: first the join form, not the map ---
  const friendPhone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const friend = await friendPhone.newPage();
  await friend.goto(`${BASE}/#/game/${gameId}`);
  await friend.getByRole('heading', { name: 'Je bent uitgenodigd' }).waitFor();
  await friend.screenshot({ path: path.join(shots, '15-join-gate.png') });
  check(!(await friend.locator('canvas').count()), 'a game link opens the join form for a new player');
  await friend.getByLabel('Jouw bedrijfsnaam').fill('Vriend & Co');
  await friend.getByLabel(/pincode/i).fill('2580');
  await friend.getByRole('button', { name: 'Meedoen' }).tap();
  await friend.locator('canvas').waitFor();
  view = await api('GET', `/api/games/${gameId}/view`);
  const friendPlayer = view.game.players.find((p) => p.name === 'Vriend & Co');
  check(!!friendPlayer, 'the friend joined and sees the game');

  // On another device (or a new link): tap the name, enter the PIN and continue as the same company.
  const otherDevice = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const other = await otherDevice.newPage();
  await other.goto(`${BASE}/#/join/${gameId}`);
  await other.locator('.chip', { hasText: 'Vriend & Co' }).tap();
  await other.getByLabel(/pincode/i).fill('2580');
  await other.screenshot({ path: path.join(shots, '16-rejoin.png') });
  await other.getByRole('button', { name: 'Verder spelen als Vriend & Co' }).tap();
  await other.locator('canvas').waitFor();
  const otherIds = await other.evaluate(() => JSON.parse(localStorage.getItem('transportrijk.identities')));
  check(otherIds[0]?.playerId === friendPlayer?.id, 'name + PIN continue as the same company on another device');
  await friendPhone.close();
  await otherDevice.close();

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

  // Touch: tap the start and the end of a track: a straight line goes into the slots.
  const rivalView = await api('GET', `/api/games/${gameId}/view`, undefined, rival.token);
  const busy = (t) => !!rivalView.game.infra.tiles[t] || rivalView.game.stations.some((st) => st.tile === t);
  const [rx, ry] = xy(rivalHq);
  let track = null;
  for (let r = 1; r <= 12 && !track; r++) {
    for (const [ox, oy] of [[r, 0], [-r - 4, 0], [0, r], [0, -r], [r, r], [-r - 4, -r]]) {
      const row = [0, 1, 2, 3, 4].map((dx) => tileOf(rx + ox + dx, ry + oy));
      if (row.every((t) => free(t) && !busy(t) && t !== rivalHq && map.terrain[t] !== 3)) {
        track = row;
        break;
      }
    }
  }
  if (track) {
    const mid = track[2];
    await mobile.evaluate((t) => window.__transportrijk.focus(t), mid);
    await mobile.waitForTimeout(700);
    for (const t of [track[0], track[track.length - 1]]) {
      const [x, y] = await mobile.evaluate((tile) => window.__transportrijk.tileToClient(tile), t);
      await mobile.touchscreen.tap(x, y);
      await mobile.waitForTimeout(250);
    }
    await mobile.screenshot({ path: path.join(shots, '13-mobile-track.png') });
    await mobile.getByRole('button', { name: 'Route plannen' }).tap();
    await mobile.waitForTimeout(900);
    const rivalOrders = (await api('GET', `/api/games/${gameId}/view`, undefined, rival.token)).orders.slots.filter(Boolean);
    check(rivalOrders.length === track.length - 1 && rivalOrders.every((a) => a.type === 'build' && a.kind === 'rail'), `tap A, tap B, ✓: a straight track (${rivalOrders.length} actions)`);
  } else log('no room for the touch track check');
} finally {
  await browser.close();
  server.kill();
}

log(failed ? 'FAILED' : 'all checks passed', `· screenshots in ${path.relative(process.cwd(), shots)}/`);
process.exit(failed ? 1 : 0);
