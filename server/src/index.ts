// Entry point: `npm run dev` (watch mode) or `npm start`.
import { fileURLToPath } from 'node:url';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));
const clientDist = process.env.CLIENT_DIST ?? fileURLToPath(new URL('../../client/dist', import.meta.url));

const app = await createApp({ dataDir, clientDist });
app.server.listen(port, host, () => {
  console.log(`Transport game server on http://localhost:${port} (data: ${dataDir})`);
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, saving games...`);
  await app.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
