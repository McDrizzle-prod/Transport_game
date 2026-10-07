// Canvas map: camera, touch/mouse input and the render loop. Lives outside React's render cycle.
import { useEffect, useRef } from 'react';
import { HQ_BONUS, STATIONS, VEHICLES, checkStationTile, coverageAt, findRoute, hqError, pointOnRoute } from '@transport/shared';
import type { Action, Edge, GameState, Route, SlotResult, Station, TurnReport, World } from '@transport/shared';
import { money } from '../format';
import { groupPath, slotGroups, slotRange } from '../state/groups';
import { useStore } from '../state/store';
import type { GameStore, UiState } from '../state/store';
import { MapRenderer } from './renderer';
import type { Camera } from './renderer';
import type { FloatingText, ReplayView, Scene, SlotMarker, ToolOverlay, VehicleSprite } from './scene';
import { buildTerrainLayer } from './terrain';

/** Replay: time per action slot (shorter when a game has many slots) and per simulation step. */
const SLOT_MS = 750;
const BUILD_MS_MAX = 6000;
const TICK_MS = 170;
const TAP_SLOP = 8;

export function MapView() {
  const store = useStore();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctrl = new MapController(ref.current!, store);
    return () => ctrl.destroy();
  }, [store]);
  return <canvas ref={ref} className="map-canvas" aria-label="Kaart" />;
}

interface Gesture {
  startX: number;
  startY: number;
  cam: Camera;
  moved: boolean;
  pinch: { dist: number; midX: number; midY: number; world: [number, number] } | null;
}

class MapController {
  private readonly renderer: MapRenderer;
  private readonly store: GameStore;
  private readonly canvas: HTMLCanvasElement;
  private cam: Camera = { x: 32, y: 32, zoom: 12 };
  private anim: { from: Camera; to: Camera; start: number; duration: number } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private terrainFor: unknown = null;
  private focusSeq = 0;
  private raf = 0;
  private dirty = true;
  private readonly unsubscribe: () => void;
  private readonly resizeObserver: ResizeObserver;
  private vehicleCache: { state: GameState; sprites: VehicleSprite[] } | null = null;
  private readonly lastAngle = new Map<number, number>();
  private fitted = false;
  private insets: unknown = null;

  constructor(canvas: HTMLCanvasElement, store: GameStore) {
    this.canvas = canvas;
    this.store = store;
    this.renderer = new MapRenderer(canvas);
    this.unsubscribe = store.subscribe(() => (this.dirty = true));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
    // Small automation hook (used by the end-to-end test to find tiles on screen).
    (window as unknown as { __transportrijk?: unknown }).__transportrijk = {
      tileToClient: (tile: number) => this.tileToClient(tile),
      camera: () => ({ ...this.cam }),
      focus: (tile: number) => this.store.focusTile(tile),
    };
  }

  private tileToClient(tile: number): [number, number] | null {
    const map = this.store.getState().map;
    if (!map) return null;
    const r = this.canvas.getBoundingClientRect();
    const [sx, sy] = this.renderer.toScreen(this.cam, (tile % map.width) + 0.5, Math.floor(tile / map.width) + 0.5);
    return [r.left + sx, r.top + sy];
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKey);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2.5));
    this.dirty = true;
  }

  // --- camera -------------------------------------------------------------------

  /** The part of the canvas not covered by panels (CSS px). */
  private visible(): { x0: number; y0: number; x1: number; y1: number } {
    const ins = this.store.getState().insets;
    const w = this.renderer.width;
    const h = this.renderer.height;
    const x0 = Math.min(ins.left, w * 0.5);
    const y0 = Math.min(ins.top, h * 0.5);
    return { x0, y0, x1: Math.max(x0 + 60, w - ins.right), y1: Math.max(y0 + 60, h - ins.bottom) };
  }

  private minZoom(): number {
    const map = this.store.getState().map;
    if (!map) return 4;
    const v = this.visible();
    return Math.max(2, Math.min((v.x1 - v.x0) / map.width, (v.y1 - v.y0) / map.height) * 0.94);
  }

  /** Keeps the visible area on the map (or centres the map when it is smaller than the view). */
  private clamp(c: Camera): Camera {
    const map = this.store.getState().map;
    const zoom = Math.max(this.minZoom(), Math.min(72, c.zoom));
    if (!map) return { ...c, zoom };
    const v = this.visible();
    const margin = 1.5;
    const axis = (pos: number, lo0: number, hi0: number, size: number, full: number) => {
      const lo = -margin - (lo0 - full / 2) / zoom;
      const hi = size + margin - (hi0 - full / 2) / zoom;
      return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, pos));
    };
    return {
      zoom,
      x: axis(c.x, v.x0, v.x1, map.width, this.renderer.width),
      y: axis(c.y, v.y0, v.y1, map.height, this.renderer.height),
    };
  }

  /** Camera that shows a tile in the middle of the free area. */
  private cameraOn(tile: number, zoom: number): Camera {
    const map = this.store.getState().map!;
    const v = this.visible();
    return {
      zoom,
      x: (tile % map.width) + 0.5 - ((v.x0 + v.x1) / 2 - this.renderer.width / 2) / zoom,
      y: Math.floor(tile / map.width) + 0.5 - ((v.y0 + v.y1) / 2 - this.renderer.height / 2) / zoom,
    };
  }

  private setCam(c: Camera): void {
    this.cam = this.clamp(c);
    this.anim = null;
    this.dirty = true;
  }

  private flyTo(to: Camera): void {
    this.anim = { from: { ...this.cam }, to: this.clamp(to), start: performance.now(), duration: 450 };
  }

  // --- input --------------------------------------------------------------------

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private tileAt(sx: number, sy: number): number | null {
    const map = this.store.getState().map;
    if (!map) return null;
    const [wx, wy] = this.renderer.toWorld(this.cam, sx, sy);
    const x = Math.floor(wx);
    const y = Math.floor(wy);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    return y * map.width + x;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.local(e);
    this.pointers.set(e.pointerId, { x, y });
    this.anim = null;
    if (this.pointers.size === 1) {
      this.gesture = { startX: x, startY: y, cam: { ...this.cam }, moved: false, pinch: null };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      this.gesture = {
        startX: midX,
        startY: midY,
        cam: { ...this.cam },
        moved: true,
        pinch: { dist: Math.hypot(a.x - b.x, a.y - b.y), midX, midY, world: this.renderer.toWorld(this.cam, midX, midY) },
      };
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const [x, y] = this.local(e);
    if (e.pointerType === 'mouse' && this.pointers.size === 0) {
      this.store.setHover(this.tileAt(x, y));
      return;
    }
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x, y });
    const g = this.gesture;
    if (!g) return;
    if (g.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const zoom = Math.max(this.minZoom(), Math.min(72, (g.cam.zoom * dist) / g.pinch.dist));
      this.setCam({
        zoom,
        x: g.pinch.world[0] - (midX - this.renderer.width / 2) / zoom,
        y: g.pinch.world[1] - (midY - this.renderer.height / 2) / zoom,
      });
      return;
    }
    if (!g.moved && Math.hypot(x - g.startX, y - g.startY) > TAP_SLOP) g.moved = true;
    if (g.moved && !g.pinch) {
      this.setCam({ zoom: g.cam.zoom, x: g.cam.x - (x - g.startX) / g.cam.zoom, y: g.cam.y - (y - g.startY) / g.cam.zoom });
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const g = this.gesture;
    const wasTap = g && !g.moved && this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.gesture = null;
    else if (this.pointers.size === 1 && g?.pinch) {
      // Continue panning with the remaining finger.
      const [p] = [...this.pointers.values()];
      this.gesture = { startX: p.x, startY: p.y, cam: { ...this.cam }, moved: true, pinch: null };
    }
    if (wasTap) {
      const [x, y] = this.local(e);
      const tile = this.tileAt(x, y);
      if (tile !== null) this.store.tapTile(tile);
    }
  };

  private onPointerCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.gesture = null;
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') this.store.setHover(null);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [x, y] = this.local(e);
    const world = this.renderer.toWorld(this.cam, x, y);
    const zoom = Math.max(this.minZoom(), Math.min(72, this.cam.zoom * Math.exp(-e.deltaY * 0.0015)));
    this.setCam({ zoom, x: world[0] - (x - this.renderer.width / 2) / zoom, y: world[1] - (y - this.renderer.height / 2) / zoom });
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    const s = this.store.getState();
    if (e.key === 'Escape') {
      if (s.replay) this.store.stopReplay();
      else if (s.tool.kind !== 'inspect' && s.tool.kind !== 'hq') this.store.setTool({ kind: 'inspect' });
      else this.store.select(null);
    } else if (e.key === 'Backspace' && s.tool.kind === 'route' && s.tool.start !== null) {
      this.store.setTool({ ...s.tool, start: null });
    } else if (e.key === '+' || e.key === '=') {
      this.flyTo({ ...this.cam, zoom: this.cam.zoom * 1.4 });
    } else if (e.key === '-') {
      this.flyTo({ ...this.cam, zoom: this.cam.zoom / 1.4 });
    }
  };

  // --- frame --------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const s = this.store.getState();
    if (!s.map || !s.view) return;

    if (this.terrainFor !== s.map) {
      this.renderer.setTerrain(buildTerrainLayer(s.map, s.view.game.industries));
      this.terrainFor = s.map;
      this.dirty = true;
    }
    if (!this.fitted && this.renderer.width > 0) {
      this.fitted = true;
      this.cam = this.clamp({ x: s.map.width / 2, y: s.map.height / 2, zoom: this.minZoom() });
    }
    if (s.insets !== this.insets) {
      // Panels opened/closed or resized: keep the view valid.
      this.insets = s.insets;
      if (!this.anim) this.cam = this.clamp(this.cam);
      this.dirty = true;
    }
    if (s.focus && s.focus.seq !== this.focusSeq) {
      this.focusSeq = s.focus.seq;
      this.flyTo(this.cameraOn(s.focus.tile, Math.max(this.cam.zoom, 18)));
    }
    if (this.anim) {
      const k = Math.min(1, (now - this.anim.start) / this.anim.duration);
      const e = 1 - (1 - k) ** 3;
      const { from, to } = this.anim;
      this.cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, zoom: from.zoom + (to.zoom - from.zoom) * e };
      if (k >= 1) {
        this.anim = null;
        this.cam = this.clamp(this.cam);
      }
      this.dirty = true;
    }
    const replaying = !!s.replay;
    if (!this.dirty && !replaying) return;
    this.dirty = false;
    const scene = this.buildScene(s, now);
    if (scene) this.renderer.draw(scene, this.cam);
  };

  private buildScene(s: UiState, now: number): Scene | null {
    const { map, view } = s;
    const world = this.store.world();
    if (!map || !view || !world) return null;
    const state = view.game;
    const me = view.you?.playerId ?? null;
    const colors = new Map(state.players.map((p) => [p.id, p.color]));

    const preview = this.store.preview();
    let plannedEdges: Edge[] = [];
    let plannedStations: Station[] = [];
    if (preview) {
      plannedEdges = Object.values(preview.world.state.infra.edges).filter((e) => e.turn === state.turn);
      plannedStations = preview.world.state.stations.filter((st) => st.builtTurn === state.turn);
    }
    const markers: SlotMarker[] = [];
    for (const g of slotGroups(s.draft)) {
      const a = s.draft[g.start];
      if (!a) continue;
      const highlighted = s.highlightSlot !== null && s.highlightSlot >= g.start && s.highlightSlot <= g.end;
      if (g.end > g.start && a.type === 'build') {
        // A route of several actions gets one marker ("2–9").
        const path = groupPath(s.draft, g);
        const outcomes = s.draft.slice(g.start, g.end + 1).map((_, k) => preview?.results[g.start + k]?.outcome ?? 'ok');
        const status = outcomes.every((o) => o === 'ok') ? 'ok' : outcomes.every((o) => o === 'failed') ? 'failed' : 'partial';
        const mid = path[Math.floor(path.length / 2)];
        markers.push({ label: slotRange(g), x: (mid % map.width) + 0.5, y: Math.floor(mid / map.width) + 0.5, status, highlighted, path, kind: a.kind });
        continue;
      }
      const tile = this.store.actionTile(a);
      if (tile !== null) markers.push(markerFor(a, g.start, tile, preview?.results[g.start] ?? null, map.width, highlighted));
    }

    let vehicles = this.staticVehicles(world);
    let texts: FloatingText[] = [];
    let replay: ReplayView | null = null;
    const report = s.report;
    if (s.replay && report && report.turn === s.replay.turn) {
      const r = this.replayFrame(report, now - s.replay.startedAt, colors);
      if (r) {
        replay = r.view;
        if (r.vehicles) vehicles = r.vehicles;
        texts = r.texts;
      } else {
        queueMicrotask(() => this.store.stopReplay());
      }
    }

    const mine = state.players.find((p) => p.id === me);
    return {
      map,
      state,
      me,
      colors,
      plannedEdges,
      plannedStations,
      markers: replay ? [] : markers,
      tool: replay ? null : this.toolOverlay(s, me),
      selection: s.selection,
      hover: s.hover,
      vehicles,
      texts,
      replay,
      showGrid: s.tool.kind !== 'inspect',
      hqZone:
        mine && mine.hq !== null && !replay
          ? { tile: mine.hq, radius: HQ_BONUS.radius, color: mine.color, label: `HQ-bonus +${Math.round(HQ_BONUS.bonus * 100)}%` }
          : null,
    };
  }

  private toolOverlay(s: UiState, me: string | null): ToolOverlay | null {
    const tool = s.tool;
    const map = s.map!;
    const game = s.view!.game;
    if (!me) return null;
    switch (tool.kind) {
      case 'route': {
        const plan = this.store.routePlan(s.hover);
        const ok = !!plan?.path && !plan.error && !plan.plan?.fatal;
        const actions = plan && ok ? this.store.routeActions(plan).length : 0;
        const free = this.store.freeSlots().length;
        return {
          kind: 'route',
          transport: tool.transport,
          start: tool.start,
          path: plan?.path ?? null,
          blocked: (plan?.plan?.blocked ?? []).map((b) => b.tile),
          label: ok && plan?.plan ? `${actions} acties · ${money(plan.plan.cost)}${actions > free ? ` · ${free} vrij` : ''}` : null,
          ok: ok && actions <= free,
        };
      }
      case 'station': {
        const tile = tool.tile ?? s.hover;
        const world = this.store.planningWorld();
        if (tile === null || !world) return { kind: 'station', station: tool.station, tile: null, ok: false, radius: 0, covered: [] };
        const check = checkStationTile(world, me, tool.station, tile);
        const cov = coverageAt(world, tool.station, tile);
        const covered: number[] = [];
        for (const ind of cov.industries) {
          for (let dy = 0; dy < ind.h; dy++) for (let dx = 0; dx < ind.w; dx++) covered.push((ind.y + dy) * map.width + ind.x + dx);
        }
        for (const c of cov.cities) covered.push(...c.tiles);
        return { kind: 'station', station: tool.station, tile, ok: check.ok && !check.exists, radius: STATIONS[tool.station].radius, covered };
      }
      case 'vehicles': {
        const world = this.store.planningWorld();
        const kind = VEHICLES[tool.model].kind;
        // Before the first pick every own station is a candidate (the vehicle adapts); after it, only the same kind.
        const candidates = world
          ? world.state.stations
              .filter((st) => world.canUse(st.owners, me) && (tool.from === null || tool.to !== null || st.kind === kind))
              .map((st) => ({ tile: st.tile, match: st.kind === kind }))
          : [];
        return { kind: 'vehicles', from: tool.from, to: tool.to, hover: s.hover, candidates };
      }
      case 'hq': {
        const hover = s.hover;
        return {
          kind: 'hq',
          hover,
          ok: hover !== null && !hqError(map, game, me, hover),
          others: game.players.filter((p) => p.id !== me && p.hq !== null).map((p) => p.hq!),
        };
      }
      default:
        return null;
    }
  }

  /** Vehicle positions at the end of the last turn, computed from the state. */
  private staticVehicles(world: World): VehicleSprite[] {
    if (this.vehicleCache?.state === world.state) return this.vehicleCache.sprites;
    const routes = new Map<number, Route | null>();
    const atStation = new Map<number, number>();
    const sprites: VehicleSprite[] = [];
    for (const v of world.state.vehicles) {
      const line = world.lineById.get(v.lineId);
      if (!line) continue;
      if (!routes.has(line.id)) {
        const a = world.stationById.get(line.stations[0]);
        const b = world.stationById.get(line.stations[1]);
        routes.set(line.id, a && b ? findRoute(world, line.owner, line.kind, a.tile, b.tile) : null);
      }
      const route = routes.get(line.id);
      const kind = VEHICLES[v.model].kind;
      const loaded = v.cargo.length > 0;
      if (route && v.state === 'moving') {
        const forward = v.dir === 0;
        const d = forward ? v.progress : route.length - v.progress;
        const [x, y] = pointOnRoute(world, route, d);
        const [x2, y2] = pointOnRoute(world, route, d + (forward ? 0.25 : -0.25));
        sprites.push({ id: v.id, owner: v.owner, model: v.model, kind, x, y, angle: Math.atan2(y2 - y, x2 - x), loaded });
      } else {
        const station = world.stationById.get(line.stations[v.dir]);
        if (!station) continue;
        const n = atStation.get(station.tile) ?? 0;
        atStation.set(station.tile, n + 1);
        const w = world.map.width;
        let angle = 0;
        if (route && route.tiles.length > 1) {
          const forward = v.dir === 0;
          const [x, y] = pointOnRoute(world, route, forward ? 0 : route.length);
          const [x2, y2] = pointOnRoute(world, route, forward ? 0.5 : route.length - 0.5);
          angle = Math.atan2(y2 - y, x2 - x);
        }
        sprites.push({
          id: v.id,
          owner: v.owner,
          model: v.model,
          kind,
          x: (station.tile % w) + 0.5 + Math.cos(angle) * 0.55 + n * 0.12,
          y: Math.floor(station.tile / w) + 0.5 + Math.sin(angle) * 0.55 + n * 0.12,
          angle,
          loaded,
        });
      }
    }
    this.vehicleCache = { state: world.state, sprites };
    return sprites;
  }

  private replayFrame(
    report: TurnReport,
    elapsed: number,
    colors: Map<string, string>,
  ): { view: ReplayView; vehicles: VehicleSprite[] | null; texts: FloatingText[] } | null {
    // Animate up to the last slot in which something happened.
    const buildSlots = report.slots.reduce((max, r) => Math.max(max, r.slot), 0);
    const slotMs = buildSlots > 0 ? Math.min(SLOT_MS, BUILD_MS_MAX / buildSlots) : SLOT_MS;
    const buildMs = buildSlots * slotMs;
    const ticks = report.replay.ticks;
    const hasVehicles = report.replay.vehicles.length > 0;
    const total = buildMs + (hasVehicles ? (ticks + 6) * TICK_MS : 0);
    if (elapsed >= total || total === 0) return null;

    const sprite = (rv: TurnReport['replay']['vehicles'][number], tick: number): VehicleSprite => {
      const f = rv.frames;
      const n = f.length / 2 - 1;
      const i = Math.max(0, Math.min(n, Math.floor(tick)));
      const j = Math.min(n, i + 1);
      const k = Math.max(0, Math.min(1, tick - i));
      const x = f[i * 2] + (f[j * 2] - f[i * 2]) * k;
      const y = f[i * 2 + 1] + (f[j * 2 + 1] - f[i * 2 + 1]) * k;
      const dx = f[j * 2] - f[i * 2];
      const dy = f[j * 2 + 1] - f[i * 2 + 1];
      let angle = this.lastAngle.get(rv.id) ?? 0;
      if (Math.abs(dx) + Math.abs(dy) > 0.001) {
        angle = Math.atan2(dy, dx);
        this.lastAngle.set(rv.id, angle);
      }
      return { id: rv.id, owner: rv.owner, model: rv.model, kind: VEHICLES[rv.model].kind, x, y, angle, loaded: false };
    };

    if (elapsed < buildMs) {
      const slot = Math.floor(elapsed / slotMs) + 1;
      const results = report.slots.filter((r) => r.slot === slot);
      // Conflicts stay marked once they happened, so they can be seen at the end of the build phase.
      const sofar = report.slots.filter((r) => r.slot <= slot);
      return {
        view: {
          turn: report.turn,
          slot,
          activeSlot: slot,
          lostTiles: sofar.flatMap((r) => r.lost.map((l) => l.tile)),
          sharedTiles: sofar.flatMap((r) => r.shared.map((sh) => sh.tile)),
          label: `Beurt ${report.turn} · actieslot ${slot} van ${buildSlots}${results.length ? '' : ' (geen acties)'}`,
        },
        vehicles: hasVehicles ? report.replay.vehicles.map((rv) => sprite(rv, 0)) : null,
        texts: [],
      };
    }
    const tick = Math.min(ticks, (elapsed - buildMs) / TICK_MS);
    const texts: FloatingText[] = report.replay.events
      .filter((ev) => ev.tick <= tick && tick - ev.tick < 7)
      .map((ev) => ({ x: ev.x, y: ev.y, text: `+${money(ev.revenue)}`, color: lighten(colors.get(ev.player) ?? '#fff'), t: (tick - ev.tick) / 7 }));
    return {
      view: { turn: report.turn, slot: 99, activeSlot: null, lostTiles: [], sharedTiles: [], label: `Beurt ${report.turn} · voertuigen rijden (${Math.floor(tick)}/${ticks})` },
      vehicles: report.replay.vehicles.map((rv) => sprite(rv, tick)),
      texts,
    };
  }
}

function markerFor(a: Action, i: number, tile: number, result: SlotResult | null, width: number, highlighted: boolean): SlotMarker {
  const c = (t: number): [number, number] => [(t % width) + 0.5, Math.floor(t / width) + 0.5];
  const status = result?.outcome ?? 'ok';
  const label = String(i + 1);
  if (a.type === 'build') {
    const [x, y] = c(tile);
    return { label, x, y, status, highlighted, path: a.path, kind: a.kind };
  }
  if (a.type === 'station' || a.type === 'sell') {
    const [x, y] = c(tile);
    return { label, x: x + 0.45, y: y - 0.45, status, highlighted };
  }
  const [fx, fy] = c(a.from);
  const [tx, ty] = c(a.to);
  return { label, x: (fx + tx) / 2, y: (fy + ty) / 2, status, highlighted, line: [fx, fy, tx, ty] };
}

function lighten(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => Math.round(v + (255 - v) * 0.45);
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}
