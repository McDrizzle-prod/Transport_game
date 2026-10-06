// Keeps games in memory and persists every game as a JSON file (good enough for a proof of concept).
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GameState, MapData, PlayerId, PlayerOrders, TurnReport } from '@transport/shared';

export interface StoredGame {
  version: 1;
  state: GameState;
  map: MapData;
  /** Secret token per player. */
  tokens: Record<PlayerId, string>;
  /** Orders for the current turn (secret until executed). */
  orders: Record<PlayerId, PlayerOrders>;
  /** Most recent turn reports, oldest first. */
  reports: TurnReport[];
}

export class GameStore {
  private readonly games = new Map<string, StoredGame>();
  private readonly dirty = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  /** `dir` = null keeps everything in memory (tests). */
  constructor(private readonly dir: string | null) {}

  async load(): Promise<void> {
    if (!this.dir) return;
    await mkdir(this.dir, { recursive: true });
    for (const file of await readdir(this.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const game = JSON.parse(await readFile(path.join(this.dir, file), 'utf8')) as StoredGame;
        this.games.set(game.state.id, game);
      } catch (err) {
        console.error(`[store] could not load ${file}:`, err);
      }
    }
  }

  get(id: string): StoredGame | undefined {
    return this.games.get(id);
  }

  all(): StoredGame[] {
    return [...this.games.values()];
  }

  add(game: StoredGame): void {
    this.games.set(game.state.id, game);
    this.markDirty(game.state.id);
  }

  markDirty(id: string): void {
    if (!this.dir) return;
    this.dirty.add(id);
    this.timer ??= setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 250);
  }

  /** Writes all changed games to disk (atomically: temp file + rename). */
  flush(): Promise<void> {
    const dir = this.dir;
    if (!dir) return Promise.resolve();
    const ids = [...this.dirty];
    this.dirty.clear();
    this.writing = this.writing.then(async () => {
      for (const id of ids) {
        const game = this.games.get(id);
        if (!game) continue;
        const file = path.join(dir, `${id}.json`);
        const tmp = `${file}.tmp`;
        try {
          await writeFile(tmp, JSON.stringify(game));
          await rename(tmp, file);
        } catch (err) {
          console.error(`[store] could not save ${id}:`, err);
        }
      }
    });
    return this.writing;
  }
}
