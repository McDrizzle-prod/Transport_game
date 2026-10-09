// Play online with friends outside your own network:
//   npm run online
// Builds the game, starts a free Cloudflare tunnel (no account needed) and the game server, and prints the
// link to share. The link changes every time you start this; your games stay on this computer
// (server/data). Players continue in a new link with the game code, their company name and their PIN.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const tools = path.join(root, '.tools');
const windows = process.platform === 'win32';
const children = [];

const say = (text) => console.log(`\x1b[36m[online]\x1b[0m ${text}`);

function stop(code = 0) {
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

// --- cloudflared: the program that makes the tunnel ------------------------------------------------------

/** Release file of cloudflared for this computer. */
function releaseFile() {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'arm' ? 'arm' : 'amd64';
  if (windows) return 'cloudflared-windows-amd64.exe';
  if (process.platform === 'darwin') return `cloudflared-darwin-${arch === 'arm64' ? 'arm64' : 'amd64'}.tgz`;
  return `cloudflared-linux-${arch}`;
}

async function cloudflared() {
  const installed = spawnSync('cloudflared', ['--version'], { stdio: 'ignore' });
  if (installed.status === 0) return 'cloudflared';
  const binary = path.join(tools, windows ? 'cloudflared.exe' : 'cloudflared');
  if (existsSync(binary)) return binary;

  mkdirSync(tools, { recursive: true });
  const file = releaseFile();
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${file}`;
  say(`cloudflared wordt eenmalig gedownload (± 40 MB) van ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download mislukt (${res.status})`);
  const tmp = path.join(tools, `${file}.part`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  if (file.endsWith('.tgz')) {
    const unpacked = spawnSync('tar', ['-xzf', tmp, '-C', tools], { stdio: 'inherit' });
    rmSync(tmp, { force: true });
    if (unpacked.status !== 0) throw new Error('uitpakken mislukt');
  } else {
    renameSync(tmp, binary);
  }
  if (!windows) chmodSync(binary, 0o755);
  return binary;
}

// --- steps -----------------------------------------------------------------------------------------------

function build() {
  say('Het spel wordt klaargemaakt (bouwen)…');
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'warn'], {
    cwd: path.join(root, 'client'),
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error('bouwen mislukt');
}

/** Starts the tunnel and resolves with its public address. */
function tunnel(binary) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let found = false;
    const timer = setTimeout(() => !found && reject(new Error('geen link ontvangen van Cloudflare (internet weg of geblokkeerd?)')), 60_000);
    const read = (data) => {
      const text = String(data);
      if (process.env.ONLINE_VERBOSE) process.stderr.write(text);
      // The address of the tunnel (not api.trycloudflare.com, which also shows up in error messages).
      const match = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/.exec(text);
      if (match && !found) {
        found = true;
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!found) reject(new Error(`cloudflared stopte (${code})`));
      else {
        say('De tunnel is gestopt.');
        stop(1);
      }
    });
  });
}

function server(publicUrl) {
  const child = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'server/src/index.ts')], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), PUBLIC_URL: publicUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', (d) => process.env.ONLINE_VERBOSE && process.stdout.write(d));
  child.stderr.on('data', (d) => process.stderr.write(d));
  child.on('exit', (code) => {
    say(`De spelserver is gestopt (${code ?? 'signaal'}).`);
    stop(1);
  });
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('de spelserver start niet');
}

/** Is something (e.g. `npm run dev`) already using the port? */
async function portInUse() {
  try {
    await fetch(`http://localhost:${PORT}/api/health`);
    return true;
  } catch {
    return false;
  }
}

try {
  if (await portInUse()) {
    throw new Error(`poort ${PORT} is al in gebruik. Draait "npm run dev" of "npm start" nog? Stop dat eerst (Ctrl+C in dat venster).`);
  }
  build();
  const binary = await cloudflared();
  say('Verbinden met Cloudflare…');
  const publicUrl = await tunnel(binary);
  server(publicUrl);
  await waitForServer();
  const line = '═'.repeat(64);
  console.log(`\n\x1b[33m${line}\x1b[0m`);
  console.log('  \x1b[1mHet spel staat online!\x1b[0m');
  console.log(`\n  Link voor je vrienden:  \x1b[1m\x1b[32m${publicUrl}\x1b[0m`);
  console.log(`  Zelf spelen op deze computer:  http://localhost:${PORT}`);
  console.log('\n  Het kan een halve minuut duren voordat de link het doet.');
  console.log('  Laat dit venster open en je computer aan zolang jullie spelen. Stoppen: Ctrl+C.');
  console.log('  Volgende keer krijg je een nieuwe link; je spellen blijven bewaard.');
  console.log(`\x1b[33m${line}\x1b[0m\n`);
} catch (err) {
  console.error(`\n\x1b[31m[online] Het lukte niet: ${err instanceof Error ? err.message : err}\x1b[0m`);
  console.error('[online] Kijk in de handleiding (README, "Online spelen met vrienden") wat je kunt doen.');
  stop(1);
}
