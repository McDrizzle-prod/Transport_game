// Development: game server (auto-restart on changes) + Vite dev server for the client.
//   npm run dev  ->  open http://localhost:5173
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const procs = [
  { name: 'server', color: 36, args: ['node_modules/tsx/dist/cli.mjs', 'watch', 'server/src/index.ts'], cwd: root },
  { name: 'client', color: 35, args: ['../node_modules/vite/bin/vite.js'], cwd: `${root}client` },
];

const children = procs.map(({ name, color, args, cwd }) => {
  const child = spawn(process.execPath, args, { cwd, env: process.env, stdio: ['inherit', 'pipe', 'pipe'] });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (data) => {
      for (const line of String(data).split(/\r?\n/)) if (line.trim()) out.write(prefix + line + '\n');
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}stopped (${code ?? 'signal'})`);
    shutdown();
  });
  return child;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
