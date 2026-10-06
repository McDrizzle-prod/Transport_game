// Client state for one game: server view, the player's draft orders, tools and selection.
import { createContext, useContext, useSyncExternalStore } from 'react';
import { ACTION_SLOTS, World, emptySlots, hqError, planRoute, previewOrders } from '@transport/shared';
import type {
  Action,
  ClientView,
  MapData,
  OrderSlots,
  OrdersPreview,
  Player,
  RoutePlan,
  StationKind,
  TransportKind,
  TurnReport,
  VehicleModelId,
} from '@transport/shared';
import { ApiError, api, connectGame } from '../api';
import { errorText } from '../i18n';
import { activeIdentity } from '../identity';
import type { Identity } from '../identity';

export type Tab = 'actions' | 'info' | 'report' | 'market' | 'players' | 'help';

export type ToolState =
  | { kind: 'inspect' }
  | { kind: 'hq' }
  | { kind: 'route'; transport: TransportKind; waypoints: number[]; stationStart: boolean; stationEnd: boolean; editSlot: number | null }
  | { kind: 'station'; station: StationKind; tile: number | null; editSlot: number | null }
  | { kind: 'vehicles'; from: number | null; to: number | null; model: VehicleModelId; count: number; editSlot: number | null };

export interface Toast {
  text: string;
  kind: 'info' | 'error' | 'ok';
  id: number;
}

/** Screen space covered by panels (px); the map centres things in the remaining area. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface UiState {
  gameId: string;
  identity: Identity | null;
  map: MapData | null;
  view: ClientView | null;
  /** serverTime - Date.now(), to show countdowns in server time. */
  clockOffset: number;
  report: TurnReport | null;
  draft: OrderSlots;
  ready: boolean;
  sync: 'saved' | 'dirty' | 'saving' | 'error';
  tool: ToolState;
  hover: number | null;
  selection: number | null;
  highlightSlot: number | null;
  tab: Tab;
  sheetOpen: boolean;
  replay: { turn: number; startedAt: number } | null;
  toast: Toast | null;
  connection: 'connecting' | 'online' | 'offline';
  focus: { tile: number; seq: number } | null;
  insets: Insets;
  loadError: string | null;
}

export class GameStore {
  private state: UiState;
  private readonly listeners = new Set<() => void>();
  private disconnect: (() => void) | null = null;
  private saveTimer: number | undefined;
  private toastTimer: number | undefined;
  private seq = 0;
  private memoWorld: { key: unknown[]; value: World } | null = null;
  private memoPreview: { key: unknown[]; value: OrdersPreview } | null = null;
  private memoPlanning = new Map<number, { key: unknown[]; value: World }>();
  private readonly routeCache = new Map<string, RoutePlan>();
  private readonly worldIds = new WeakMap<World, number>();

  constructor(gameId: string) {
    this.state = {
      gameId,
      identity: null,
      map: null,
      view: null,
      clockOffset: 0,
      report: null,
      draft: emptySlots(),
      ready: false,
      sync: 'saved',
      tool: { kind: 'inspect' },
      hover: null,
      selection: null,
      highlightSlot: null,
      tab: 'actions',
      sheetOpen: true,
      replay: null,
      toast: null,
      connection: 'connecting',
      focus: null,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      loadError: null,
    };
  }

  getState = (): UiState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(): Promise<void> {
    const { gameId } = this.state;
    const identity = activeIdentity(gameId);
    this.set({ identity });
    try {
      const [map, view] = await Promise.all([api.map(gameId), api.view(gameId, identity?.token ?? null)]);
      this.set({ map });
      this.receiveView(view);
      const firstFocus = view.game.players.find((p) => p.id === view.you?.playerId)?.hq;
      this.focusTile(firstFocus ?? Math.floor(map.width * map.height / 2 + map.width / 2));
    } catch (err) {
      this.set({ loadError: errorText(err instanceof ApiError ? err.code : 'network') });
      return;
    }
    this.disconnect = connectGame(
      gameId,
      identity?.token ?? null,
      (v) => this.receiveView(v),
      (connection) => this.set({ connection }),
    );
  }

  stop(): void {
    this.disconnect?.();
    window.clearTimeout(this.saveTimer);
    window.clearTimeout(this.toastTimer);
  }

  private receiveView(view: ClientView): void {
    const prev = this.state.view;
    const turnChanged = !!prev && prev.game.turn !== view.game.turn;
    const patch: Partial<UiState> = { view, clockOffset: view.serverTime - Date.now() };
    if ((!prev || turnChanged || this.state.sync === 'saved') && view.orders) {
      patch.draft = view.orders.slots;
      patch.ready = view.orders.ready;
      patch.sync = 'saved';
    }
    if (turnChanged) {
      patch.tool = { kind: 'inspect' };
      patch.tab = 'report';
      patch.sheetOpen = true;
      patch.highlightSlot = null;
    }
    const me = view.game.players.find((p) => p.id === view.you?.playerId);
    const prevHq = prev?.game.players.find((p) => p.id === view.you?.playerId)?.hq ?? null;
    if (me && me.hq === null && this.state.tool.kind === 'inspect' && !prev) patch.tool = { kind: 'hq' };
    // Headquarters just placed or moved: done with the placement tool.
    if (me && me.hq !== null && me.hq !== prevHq && this.state.tool.kind === 'hq') patch.tool = { kind: 'inspect' };
    this.set(patch);
    const meId = view.you?.playerId;
    if (prev && meId) {
      const had = new Set(prev.game.invites.filter((i) => i.to === meId).map((i) => i.from));
      const fresh = view.game.invites.find((i) => i.to === meId && !had.has(i.from));
      if (fresh) this.toast(`${this.playerName(fresh.from)} stelt een alliantie voor (zie Spelers)`, 'info');
    }
    if (view.lastReportTurn !== null && view.lastReportTurn !== this.state.report?.turn) {
      void this.loadReport(view.lastReportTurn, turnChanged);
    }
  }

  private async loadReport(turn: number, autoplay: boolean): Promise<void> {
    try {
      const report = await api.report(this.state.gameId, turn);
      this.set({ report });
      if (autoplay) this.playReplay();
    } catch {
      // Reports are optional (e.g. trimmed on the server).
    }
  }

  // --- Derived data ------------------------------------------------------------

  me(): Player | null {
    const { view } = this.state;
    return view?.game.players.find((p) => p.id === view.you?.playerId) ?? null;
  }

  playerName = (id: string): string => this.state.view?.game.players.find((p) => p.id === id)?.name ?? '?';

  /** World of the current (server) state. */
  world(): World | null {
    const { map, view } = this.state;
    if (!map || !view) return null;
    const key = [map, view.game];
    if (!this.memoWorld || !same(this.memoWorld.key, key)) this.memoWorld = { key, value: new World(map, view.game) };
    return this.memoWorld.value;
  }

  /** What the draft orders would do if nobody else interferes. */
  preview(): OrdersPreview | null {
    const { map, view, draft } = this.state;
    const me = view?.you?.playerId;
    if (!map || !view || !me || view.game.phase !== 'running') return null;
    const key = [map, view.game, draft];
    if (!this.memoPreview || !same(this.memoPreview.key, key)) {
      this.memoPreview = { key, value: previewOrders(map, view.game, me, draft) };
    }
    return this.memoPreview.value;
  }

  /** Slot a new action from the active tool goes to (0-based), or -1 when all are full. */
  targetSlot(): number {
    const tool = this.state.tool;
    if ('editSlot' in tool && tool.editSlot !== null) return tool.editSlot;
    return this.state.draft.findIndex((s) => s === null);
  }

  /** The world as it will be right before the target slot executes (earlier planned actions included). */
  planningWorld(): World | null {
    const { map, view, draft } = this.state;
    const me = view?.you?.playerId;
    if (!map || !view || !me) return null;
    const slot = this.targetSlot();
    const upTo = slot < 0 ? ACTION_SLOTS : slot;
    const slots = draft.map((a, i) => (i < upTo ? a : null));
    const key = [map, view.game, ...slots];
    const cached = this.memoPlanning.get(upTo);
    if (cached && same(cached.key, key)) return cached.value;
    const value = previewOrders(map, view.game, me, slots).world;
    this.memoPlanning.set(upTo, { key, value });
    return value;
  }

  /** Route through the waypoints of the route tool (plus an optional hover tile). */
  routePlan(extra: number | null = null): RoutePlan | null {
    const tool = this.state.tool;
    const me = this.state.view?.you?.playerId;
    if (tool.kind !== 'route' || !me) return null;
    const points = extra !== null && tool.waypoints[tool.waypoints.length - 1] !== extra ? [...tool.waypoints, extra] : tool.waypoints;
    if (points.length < 2) return null;
    const world = this.planningWorld();
    if (!world) return null;
    let worldId = this.worldIds.get(world);
    if (worldId === undefined) this.worldIds.set(world, (worldId = ++this.seq));
    const key = `${worldId}|${tool.transport}|${points.join(',')}`;
    let plan = this.routeCache.get(key);
    if (!plan) {
      plan = planRoute(world, me, tool.transport, points);
      if (this.routeCache.size > 24) this.routeCache.delete(this.routeCache.keys().next().value!);
      this.routeCache.set(key, plan);
    }
    return plan;
  }

  serverNow(): number {
    return Date.now() + this.state.clockOffset;
  }

  // --- Orders ------------------------------------------------------------------

  private setDraft(draft: OrderSlots, ready = false): void {
    this.set({ draft, ready, sync: 'dirty' });
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), 500);
  }

  addAction(action: Action): boolean {
    const slot = this.targetSlot();
    if (slot < 0) {
      this.toast('Alle 5 actieslots zijn gevuld. Verwijder eerst een actie.', 'error');
      return false;
    }
    const draft = [...this.state.draft];
    draft[slot] = action;
    this.setDraft(draft);
    this.set({ tool: { kind: 'inspect' }, tab: 'actions', highlightSlot: slot });
    this.toast(`Actie in slot ${slot + 1} gezet`, 'ok');
    return true;
  }

  removeSlot(i: number): void {
    const draft = [...this.state.draft];
    draft[i] = null;
    this.setDraft(draft);
    if (this.state.highlightSlot === i) this.set({ highlightSlot: null });
  }

  moveSlot(i: number, delta: -1 | 1): void {
    const j = i + delta;
    if (j < 0 || j >= ACTION_SLOTS) return;
    const draft = [...this.state.draft];
    [draft[i], draft[j]] = [draft[j], draft[i]];
    this.setDraft(draft);
    this.set({ highlightSlot: j });
  }

  setReady(ready: boolean): void {
    this.set({ ready, sync: 'dirty' });
    void this.save();
  }

  async save(): Promise<void> {
    const { identity, gameId, draft, ready } = this.state;
    if (!identity) return;
    window.clearTimeout(this.saveTimer);
    this.set({ sync: 'saving' });
    try {
      await api.setOrders(gameId, identity.token, draft, ready);
      if (this.state.draft === draft && this.state.ready === ready) this.set({ sync: 'saved' });
      else this.saveTimer = window.setTimeout(() => void this.save(), 300);
    } catch (err) {
      this.set({ sync: 'error' });
      this.toast(errorText(err instanceof ApiError ? err.code : 'network'), 'error');
    }
  }

  editSlot(i: number): void {
    const a = this.state.draft[i];
    if (!a) return;
    if (a.type === 'build') {
      this.setTool({
        kind: 'route',
        transport: a.kind,
        waypoints: [a.path[0], a.path[a.path.length - 1]],
        stationStart: !!a.stationStart,
        stationEnd: !!a.stationEnd,
        editSlot: i,
      });
    } else if (a.type === 'station') {
      this.setTool({ kind: 'station', station: a.kind, tile: a.tile, editSlot: i });
    } else if (a.type === 'vehicles') {
      this.setTool({ kind: 'vehicles', from: a.from, to: a.to, model: a.model, count: a.count, editSlot: i });
    }
  }

  /** Tile that represents an action on the map (for focusing the camera). */
  actionTile(a: Action): number | null {
    if (a.type === 'build') return a.path[Math.floor(a.path.length / 2)];
    if (a.type === 'station') return a.tile;
    if (a.type === 'vehicles') return a.from;
    const line = this.state.view?.game.lines.find((l) => l.id === a.line);
    return this.state.view?.game.stations.find((st) => st.id === line?.stations[0])?.tile ?? null;
  }

  // --- Tools & map interaction ---------------------------------------------------

  setTool(tool: ToolState): void {
    this.set({ tool, tab: tool.kind === 'inspect' ? this.state.tab : 'actions', sheetOpen: true });
  }

  setHover(hover: number | null): void {
    if (hover !== this.state.hover) this.set({ hover });
  }

  tapTile(tile: number): void {
    const tool = this.state.tool;
    switch (tool.kind) {
      case 'inspect':
        this.set({ selection: tile, tab: 'info', sheetOpen: true });
        return;
      case 'hq':
        void this.placeHq(tile);
        return;
      case 'route': {
        if (tool.waypoints[tool.waypoints.length - 1] === tile) return;
        if (tool.waypoints.length === 0) {
          this.set({ tool: { ...tool, waypoints: [tile] } });
          return;
        }
        const plan = this.routePlan(tile);
        if (!plan?.path || plan.error) {
          this.toast(errorText(plan?.error ?? 'unreachable'), 'error');
          return;
        }
        this.set({ tool: { ...tool, waypoints: [...tool.waypoints, tile] } });
        return;
      }
      case 'station':
        this.set({ tool: { ...tool, tile } });
        return;
      case 'vehicles': {
        const world = this.planningWorld();
        const station = world?.stationAt.get(tile);
        const me = this.state.view?.you?.playerId;
        if (!station || !me || !world?.canUse(station.owners, me)) {
          this.toast('Tik op een station van jou of een bondgenoot (geplande stations tellen ook).', 'info');
          return;
        }
        if (tool.from === null || (tool.from !== null && tool.to !== null)) {
          this.set({ tool: { ...tool, from: tile, to: null } });
        } else if (tile !== tool.from) {
          this.set({ tool: { ...tool, to: tile } });
        }
        return;
      }
    }
  }

  select(tile: number | null): void {
    this.set({ selection: tile, tab: tile === null ? this.state.tab : 'info', sheetOpen: true });
  }

  setTab(tab: Tab): void {
    this.set({ tab, sheetOpen: true });
  }

  toggleSheet(open?: boolean): void {
    this.set({ sheetOpen: open ?? !this.state.sheetOpen });
  }

  highlight(slot: number | null): void {
    this.set({ highlightSlot: slot });
    const a = slot !== null ? this.state.draft[slot] : null;
    const tile = a ? this.actionTile(a) : null;
    if (tile !== null) this.focusTile(tile);
  }

  setInsets(insets: Insets): void {
    const cur = this.state.insets;
    if (cur.top === insets.top && cur.right === insets.right && cur.bottom === insets.bottom && cur.left === insets.left) return;
    this.set({ insets });
  }

  focusTile(tile: number): void {
    this.set({ focus: { tile, seq: ++this.seq } });
  }

  toast(text: string, kind: Toast['kind'] = 'info'): void {
    window.clearTimeout(this.toastTimer);
    this.set({ toast: { text, kind, id: ++this.seq } });
    this.toastTimer = window.setTimeout(() => this.set({ toast: null }), kind === 'error' ? 5000 : 3000);
  }

  playReplay(): void {
    if (this.state.report) this.set({ replay: { turn: this.state.report.turn, startedAt: performance.now() } });
  }

  stopReplay(): void {
    this.set({ replay: null });
  }

  // --- Game actions ----------------------------------------------------------------

  async placeHq(tile: number): Promise<void> {
    const { identity, gameId, map, view } = this.state;
    if (!identity || !map || !view) return;
    const error = hqError(map, view.game, identity.playerId, tile);
    if (error) {
      this.toast(errorText(error.code), 'error');
      return;
    }
    try {
      await api.placeHq(gameId, identity.token, tile);
      this.toast('Hoofdkantoor geplaatst', 'ok');
      if (view.game.phase === 'running') this.set({ tool: { kind: 'inspect' } });
    } catch (err) {
      this.toast(errorText(err instanceof ApiError ? err.code : 'network'), 'error');
    }
  }

  async startGame(): Promise<void> {
    const { identity, gameId } = this.state;
    if (!identity) return;
    try {
      await api.start(gameId, identity.token);
      this.set({ tool: { kind: 'inspect' }, tab: 'actions' });
      this.toast('Het spel is gestart! Plan je eerste acties.', 'ok');
    } catch (err) {
      this.toast(errorText(err instanceof ApiError ? err.code : 'network'), 'error');
    }
  }

  async alliance(action: 'invite' | 'accept' | 'decline' | 'leave', player?: string): Promise<void> {
    const { identity, gameId } = this.state;
    if (!identity) return;
    try {
      await api.alliance(gameId, identity.token, action, player);
      const name = player ? this.playerName(player) : '';
      const text = {
        invite: `Alliantie voorgesteld aan ${name}`,
        accept: `Je bent nu bondgenoot van ${name}`,
        decline: 'Voorstel geweigerd',
        leave: 'Je hebt de alliantie verlaten',
      }[action];
      this.toast(text, 'ok');
    } catch (err) {
      this.toast(errorText(err instanceof ApiError ? err.code : 'network'), 'error');
    }
  }

  async resolveNow(): Promise<void> {
    const { identity, gameId } = this.state;
    if (!identity) return;
    if (this.state.sync !== 'saved') await this.save();
    try {
      await api.resolve(gameId, identity.token);
    } catch (err) {
      this.toast(errorText(err instanceof ApiError ? err.code : 'network'), 'error');
    }
  }
}

function same(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export const StoreContext = createContext<GameStore | null>(null);

export function useStore(): GameStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreContext missing');
  return store;
}

/** Subscribe to a slice of the UI state. The selector must return a stable value (a field, not a new object). */
export function useUi<T>(selector: (s: UiState) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
