// Draws one frame of the map: terrain layer + infrastructure, stations, vehicles, plans and overlays.
import { CARGO, HQ_BONUS, INDUSTRIES, MIN_HQ_DISTANCE, STATIONS, Terrain, cityPassengers } from '@transport/shared';
import type { CargoId } from '@transport/shared';
import type { Edge, Station } from '@transport/shared';
import { INFRA, hexToRgba } from './palette';
import type { Scene, SlotMarker, ToolOverlay, VehicleSprite } from './scene';
import type { TerrainLayer } from './terrain';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface View {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const KIND_COLOR = { road: '#6f7378', rail: '#7b4a2e', canal: '#3f86c6' } as const;

export class MapRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private terrain: TerrainLayer | null = null;
  private readonly glyphs = new Map<string, HTMLCanvasElement>();
  width = 0;
  height = 0;
  dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  setTerrain(layer: TerrainLayer | null): void {
    this.terrain = layer;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  toScreen(cam: Camera, wx: number, wy: number): [number, number] {
    return [(wx - cam.x) * cam.zoom + this.width / 2, (wy - cam.y) * cam.zoom + this.height / 2];
  }

  toWorld(cam: Camera, sx: number, sy: number): [number, number] {
    return [(sx - this.width / 2) / cam.zoom + cam.x, (sy - this.height / 2) / cam.zoom + cam.y];
  }

  draw(scene: Scene, cam: Camera): void {
    const ctx = this.ctx;
    const { map } = scene;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#14202a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const k = this.dpr * cam.zoom;
    ctx.setTransform(k, 0, 0, k, this.dpr * (this.width / 2 - cam.x * cam.zoom), this.dpr * (this.height / 2 - cam.y * cam.zoom));
    const [x0, y0] = this.toWorld(cam, 0, 0);
    const [x1, y1] = this.toWorld(cam, this.width, this.height);
    const view: View = { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 };

    if (this.terrain) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.terrain.canvas, 0, 0, map.width, map.height);
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 2 / cam.zoom;
    ctx.strokeRect(0, 0, map.width, map.height);

    if (scene.showGrid && cam.zoom >= 14) this.drawGrid(scene, view, cam.zoom);
    if (scene.hqZone) this.drawHqZone(scene.map.width, scene.hqZone, cam.zoom);

    const hide = scene.replay;
    const edges = Object.values(scene.state.infra.edges).filter(
      (e) => !(hide && e.turn === hide.turn && e.slot > hide.slot) && this.edgeVisible(e, map.width, view),
    );
    this.drawEdges(scene, edges, cam.zoom);
    if (hide?.activeSlot) {
      const fresh = edges.filter((e) => e.turn === hide.turn && e.slot === hide.activeSlot);
      this.glowEdges(scene, fresh);
    }
    this.drawPlannedEdges(scene, scene.plannedEdges.filter((e) => this.edgeVisible(e, map.width, view)), cam.zoom);
    if (scene.tool) this.drawToolWorld(scene, scene.tool, cam.zoom);
    this.drawVehicles(scene, scene.vehicles, view, cam.zoom);
    this.drawSelection(scene, cam.zoom);

    // Screen space from here on.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawIndustries(scene, cam, view);
    this.drawCities(scene, cam);
    this.drawStations(scene, cam, view);
    this.drawHqs(scene, cam);
    if (scene.hqZone && cam.zoom >= 6) {
      const z = scene.hqZone;
      const [lx, ly] = this.toScreen(cam, (z.tile % map.width) - z.radius, Math.floor(z.tile / map.width) - z.radius);
      this.label(z.label, lx + 6, ly + 10, `700 11px ${UI_FONT}`, '#fff', 'left');
    }
    if (hide) this.drawReplayMarks(scene, cam, hide);
    for (const m of scene.markers) this.drawMarker(scene, cam, m);
    if (scene.tool) this.drawToolScreen(scene, cam, scene.tool);
    this.drawTexts(scene, cam);
    if (hide) this.banner(hide.label);
  }

  // --- helpers ------------------------------------------------------------------

  private edgeVisible(e: Edge, w: number, v: View): boolean {
    const ax = e.a % w;
    const ay = (e.a / w) | 0;
    const bx = e.b % w;
    const by = (e.b / w) | 0;
    return Math.max(ax, bx) >= v.x0 && Math.min(ax, bx) <= v.x1 && Math.max(ay, by) >= v.y0 && Math.min(ay, by) <= v.y1;
  }

  private center(scene: Scene, tile: number): [number, number] {
    const w = scene.map.width;
    return [(tile % w) + 0.5, ((tile / w) | 0) + 0.5];
  }

  private strokeEdges(scene: Scene, list: Edge[], width: number, color: string, dash: number[] = []): void {
    if (!list.length) return;
    const ctx = this.ctx;
    ctx.beginPath();
    for (const e of list) {
      const [ax, ay] = this.center(scene, e.a);
      const [bx, by] = this.center(scene, e.b);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private byOwner(list: Edge[], index = 0): Map<string, Edge[]> {
    const groups = new Map<string, Edge[]>();
    for (const e of list) {
      const owner = e.owners[index];
      if (!owner) continue;
      const g = groups.get(owner);
      if (g) g.push(e);
      else groups.set(owner, [e]);
    }
    return groups;
  }

  private glyph(emoji: string, size: number): HTMLCanvasElement {
    const px = Math.max(8, Math.round((size * this.dpr) / 2) * 2);
    const key = `${emoji}|${px}`;
    let c = this.glyphs.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = Math.ceil(px * 1.35);
      const g = c.getContext('2d')!;
      g.font = `${px}px ${EMOJI_FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(emoji, c.width / 2, c.height / 2 + px * 0.07);
      this.glyphs.set(key, c);
    }
    return c;
  }

  private drawGlyph(emoji: string, x: number, y: number, size: number): void {
    const g = this.glyph(emoji, size);
    const s = g.width / this.dpr;
    this.ctx.drawImage(g, x - s / 2, y - s / 2, s, s);
  }

  private label(text: string, x: number, y: number, font: string, color = '#fff', align: CanvasTextAlign = 'center'): void {
    const ctx = this.ctx;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(12, 18, 24, 0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  // --- world layers ------------------------------------------------------------

  private drawGrid(scene: Scene, v: View, zoom: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.09)';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    const xs = Math.max(0, Math.floor(v.x0));
    const xe = Math.min(scene.map.width, Math.ceil(v.x1));
    const ys = Math.max(0, Math.floor(v.y0));
    const ye = Math.min(scene.map.height, Math.ceil(v.y1));
    for (let x = xs; x <= xe; x++) {
      ctx.moveTo(x, ys);
      ctx.lineTo(x, ye);
    }
    for (let y = ys; y <= ye; y++) {
      ctx.moveTo(xs, y);
      ctx.lineTo(xe, y);
    }
    ctx.stroke();
  }

  /** Dashed square around the own headquarters: the area where deliveries earn a bonus. */
  private drawHqZone(width: number, zone: NonNullable<Scene['hqZone']>, zoom: number): void {
    const ctx = this.ctx;
    const x = (zone.tile % width) - zone.radius;
    const y = Math.floor(zone.tile / width) - zone.radius;
    const size = 2 * zone.radius + 1;
    ctx.fillStyle = hexToRgba(zone.color, 0.06);
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = hexToRgba(zone.color, 0.85);
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.strokeRect(x, y, size, size);
    ctx.setLineDash([]);
  }

  private drawEdges(scene: Scene, edges: Edge[], zoom: number): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const color = (id: string) => scene.colors.get(id) ?? '#999';
    const water = (t: number) => scene.map.terrain[t] === Terrain.Water;
    const roads = edges.filter((e) => e.kind === 'road');
    const rails = edges.filter((e) => e.kind === 'rail');
    const canals = edges.filter((e) => e.kind === 'canal');
    const minW = (w: number) => Math.max(w, 1.4 / zoom);

    // Bridges get a dark deck underneath.
    this.strokeEdges(scene, edges.filter((e) => e.kind !== 'canal' && (water(e.a) || water(e.b))), 0.7, INFRA.bridge);

    // Owner colour casing, so every connection shows who owns it. Shared segments get a dashed second colour.
    const casing = (list: Edge[], width: number) => {
      for (const [owner, group] of this.byOwner(list)) this.strokeEdges(scene, group, minW(width), color(owner));
      for (const [owner, group] of this.byOwner(list, 1)) this.strokeEdges(scene, group, minW(width), color(owner), [0.25, 0.25]);
    };

    casing(canals, 0.7);
    this.strokeEdges(scene, canals, minW(0.56), INFRA.canalStone);
    this.strokeEdges(scene, canals, minW(0.42), INFRA.canalWater);

    casing(roads, 0.52);
    this.strokeEdges(scene, roads, minW(0.38), INFRA.asphalt);
    if (zoom >= 14) this.strokeEdges(scene, roads, 0.035, INFRA.roadLine, [0.16, 0.16]);

    casing(rails, 0.54);
    this.strokeEdges(scene, rails, minW(0.38), INFRA.ballast);
    if (zoom >= 9) {
      this.strokeEdges(scene, rails, 0.36, INFRA.sleeper, [0.07, 0.11]);
      // Two rails, offset to both sides of the centre line.
      ctx.beginPath();
      for (const e of rails) {
        const [ax, ay] = this.center(scene, e.a);
        const [bx, by] = this.center(scene, e.b);
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = (-(by - ay) / len) * 0.1;
        const ny = ((bx - ax) / len) * 0.1;
        ctx.moveTo(ax + nx, ay + ny);
        ctx.lineTo(bx + nx, by + ny);
        ctx.moveTo(ax - nx, ay - ny);
        ctx.lineTo(bx - nx, by - ny);
      }
      ctx.strokeStyle = INFRA.railDark;
      ctx.lineWidth = Math.max(0.07, 1.2 / zoom);
      ctx.stroke();
      ctx.strokeStyle = INFRA.rail;
      ctx.lineWidth = Math.max(0.035, 0.6 / zoom);
      ctx.stroke();
    } else {
      this.strokeEdges(scene, rails, minW(0.12), INFRA.railDark);
    }
  }

  private glowEdges(scene: Scene, edges: Edge[]): void {
    if (!edges.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this.strokeEdges(scene, edges, 0.9, 'rgba(255, 240, 160, 0.35)');
    ctx.restore();
  }

  private drawPlannedEdges(scene: Scene, edges: Edge[], zoom: number): void {
    if (!edges.length) return;
    const myColor = (scene.me && scene.colors.get(scene.me)) || '#fff';
    this.ctx.lineCap = 'round';
    this.strokeEdges(scene, edges, Math.max(0.5, 3 / zoom), hexToRgba(myColor, 0.9), [0.32, 0.18]);
    for (const kind of ['road', 'rail', 'canal'] as const) {
      this.strokeEdges(scene, edges.filter((e) => e.kind === kind), Math.max(0.2, 1.4 / zoom), hexToRgba(KIND_COLOR[kind], 0.95));
    }
    this.strokeEdges(scene, edges, Math.max(0.06, 0.8 / zoom), 'rgba(255, 255, 255, 0.85)', [0.1, 0.22]);
  }

  private drawVehicles(scene: Scene, list: VehicleSprite[], v: View, zoom: number): void {
    const ctx = this.ctx;
    for (const s of list) {
      if (s.x < v.x0 || s.x > v.x1 || s.y < v.y0 || s.y > v.y1) continue;
      const color = scene.colors.get(s.owner) ?? '#999';
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      // Keep vehicles recognisable when zoomed out: a minimum size on screen.
      const length = s.kind === 'rail' ? 1 : s.kind === 'road' ? 0.48 : 0.87;
      const k = Math.max(1, (s.kind === 'road' ? 16 : 26) / (length * zoom));
      ctx.scale(k, k);
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fillStyle = color;
      if (s.kind === 'rail') {
        // Locomotive + wagons.
        for (let k = 0; k < 3; k++) {
          this.roundRect(-0.5 + k * 0.34 - 0.02, -0.15, 0.3, 0.3, 0.06);
          ctx.fillStyle = k === 2 ? shade(color, -40) : color;
          ctx.fill();
          ctx.stroke();
        }
      } else if (s.kind === 'road') {
        this.roundRect(-0.24, -0.14, 0.48, 0.28, 0.06);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = shade(color, -50);
        this.roundRect(0.1, -0.12, 0.13, 0.24, 0.04);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(-0.42, -0.17);
        ctx.lineTo(0.25, -0.17);
        ctx.lineTo(0.45, 0);
        ctx.lineTo(0.25, 0.17);
        ctx.lineTo(-0.42, 0.17);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f2efe6';
        ctx.fillRect(-0.32, -0.09, 0.22, 0.18);
      }
      if (s.loaded) {
        ctx.fillStyle = '#ffd54a';
        ctx.beginPath();
        ctx.arc(-0.05, 0, 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawToolWorld(scene: Scene, tool: ToolOverlay, zoom: number): void {
    const ctx = this.ctx;
    const tileRect = (t: number, fill: string, stroke?: string) => {
      const x = t % scene.map.width;
      const y = (t / scene.map.width) | 0;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, 1, 1);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(x, y, 1, 1);
      }
    };
    const pathLine = (path: number[], color: string, width: number, dash: number[] = []) => {
      ctx.beginPath();
      path.forEach((t, i) => {
        const [x, y] = this.center(scene, t);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    switch (tool.kind) {
      case 'route': {
        const color = KIND_COLOR[tool.transport];
        if (tool.path) {
          pathLine(tool.path, 'rgba(255, 255, 255, 0.9)', Math.max(0.42, 4.5 / zoom));
          pathLine(tool.path, hexToRgba(color, tool.ok ? 1 : 0.7), Math.max(0.28, 3 / zoom), tool.ok ? [] : [0.3, 0.2]);
          // One action per segment: mark the tiles.
          if (zoom >= 10) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            for (const t of tool.path) {
              const [x, y] = this.center(scene, t);
              ctx.beginPath();
              ctx.arc(x, y, Math.max(0.07, 2 / zoom), 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        for (const t of tool.blocked) tileRect(t, 'rgba(220, 40, 40, 0.45)', '#ff5252');
        break;
      }
      case 'station': {
        if (tool.tile === null) break;
        const x = tool.tile % scene.map.width;
        const y = (tool.tile / scene.map.width) | 0;
        const r = tool.radius;
        ctx.fillStyle = tool.ok ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 60, 60, 0.12)';
        ctx.fillRect(x - r, y - r, 2 * r + 1, 2 * r + 1);
        ctx.strokeStyle = tool.ok ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 90, 90, 0.9)';
        ctx.lineWidth = 2 / zoom;
        ctx.setLineDash([0.3, 0.2]);
        ctx.strokeRect(x - r, y - r, 2 * r + 1, 2 * r + 1);
        ctx.setLineDash([]);
        for (const t of tool.covered) tileRect(t, 'rgba(255, 213, 74, 0.35)');
        tileRect(tool.tile, tool.ok ? 'rgba(80, 220, 120, 0.55)' : 'rgba(230, 60, 60, 0.6)', '#fff');
        break;
      }
      case 'vehicles': {
        if (tool.from !== null) {
          const target = tool.to ?? tool.hover;
          if (target !== null && target !== tool.from) {
            const [ax, ay] = this.center(scene, tool.from);
            const [bx, by] = this.center(scene, target);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = Math.max(0.12, 2.5 / zoom);
            ctx.setLineDash([0.4, 0.25]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        break;
      }
      case 'hq': {
        for (const t of tool.others) {
          const x = t % scene.map.width;
          const y = (t / scene.map.width) | 0;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 2 / zoom;
          ctx.setLineDash([0.3, 0.3]);
          const r = MIN_HQ_DISTANCE - 1;
          ctx.strokeRect(x - r, y - r, 2 * r + 1, 2 * r + 1);
          ctx.setLineDash([]);
        }
        if (tool.hover !== null) {
          // Preview of the bonus area around the headquarters.
          const r = HQ_BONUS.radius;
          const x = tool.hover % scene.map.width;
          const y = (tool.hover / scene.map.width) | 0;
          ctx.fillStyle = tool.ok ? 'rgba(255, 213, 74, 0.08)' : 'rgba(0, 0, 0, 0)';
          ctx.fillRect(x - r, y - r, 2 * r + 1, 2 * r + 1);
          ctx.strokeStyle = 'rgba(255, 213, 74, 0.8)';
          ctx.lineWidth = 2 / zoom;
          ctx.setLineDash([0.4, 0.3]);
          ctx.strokeRect(x - r, y - r, 2 * r + 1, 2 * r + 1);
          ctx.setLineDash([]);
          tileRect(tool.hover, tool.ok ? 'rgba(80, 220, 120, 0.6)' : 'rgba(230, 60, 60, 0.6)', '#fff');
        }
        break;
      }
    }
  }

  private drawSelection(scene: Scene, zoom: number): void {
    const ctx = this.ctx;
    const w = scene.map.width;
    if (scene.hover !== null && (!scene.tool || scene.tool.kind === 'route' || scene.tool.kind === 'vehicles')) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1.5 / zoom;
      ctx.strokeRect(scene.hover % w, (scene.hover / w) | 0, 1, 1);
    }
    if (scene.selection === null) return;
    const sel = scene.selection;
    const ind = scene.state.industries.find(
      (i) => sel % w >= i.x && sel % w < i.x + i.w && ((sel / w) | 0) >= i.y && ((sel / w) | 0) < i.y + i.h,
    );
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3 / zoom;
    if (ind) ctx.strokeRect(ind.x - 0.05, ind.y - 0.05, ind.w + 0.1, ind.h + 0.1);
    else ctx.strokeRect(sel % w, (sel / w) | 0, 1, 1);
    const station = scene.state.stations.find((s) => s.tile === sel);
    if (station) {
      const r = STATIONS[station.kind].radius;
      ctx.setLineDash([0.3, 0.2]);
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect((sel % w) - r, ((sel / w) | 0) - r, 2 * r + 1, 2 * r + 1);
      ctx.setLineDash([]);
    }
  }

  // --- screen layers -------------------------------------------------------------

  private drawIndustries(scene: Scene, cam: Camera, v: View): void {
    const size = Math.max(18, Math.min(34, cam.zoom * 1.1));
    for (const ind of scene.state.industries) {
      if (ind.x + ind.w < v.x0 || ind.x > v.x1 || ind.y + ind.h < v.y0 || ind.y > v.y1) continue;
      const def = INDUSTRIES[ind.type];
      const [sx, sy] = this.toScreen(cam, ind.x + ind.w / 2, ind.y + ind.h / 2);
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.beginPath();
      ctx.arc(sx, sy, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = def.color;
      ctx.stroke();
      this.drawGlyph(def.icon, sx, sy, size * 0.58);
      if (cam.zoom >= 11) {
        this.label(ind.name, sx, sy + size / 2 + 9, `600 11px ${UI_FONT}`);
        if (cam.zoom >= 18) {
          const line = def.inputs
            ? `${Object.keys(def.inputs).map((c) => CARGO[c as keyof typeof CARGO].icon).join('+')} → ${CARGO[def.output].icon}`
            : `${CARGO[def.output].icon} ${ind.rate}/beurt`;
          this.label(line, sx, sy + size / 2 + 23, `11px ${UI_FONT}`, '#ffe9a8');
        }
      }
    }
  }

  private drawCities(scene: Scene, cam: Camera): void {
    for (const c of scene.map.cities) {
      const [sx, sy] = this.toScreen(cam, c.x + 0.5, c.y + 0.5);
      if (sx < -100 || sy < -50 || sx > this.width + 100 || sy > this.height + 50) continue;
      const size = Math.round(Math.max(13, Math.min(18, 10 + cam.zoom * 0.3)));
      const top = sy - c.radius * cam.zoom * 0.2 - 4;
      this.label(c.name, sx, top, `700 ${size}px ${UI_FONT}`);
      if (cam.zoom >= 8) {
        // What the city wants: goods (icons) and passengers to other cities.
        const wants = (Object.keys(c.demand) as CargoId[]).map((cargo) => CARGO[cargo].icon).join('');
        this.label(`${wants} · 👥 ${cityPassengers(c)}/beurt`, sx, top + 16, `12px ${UI_FONT}`, '#ffe9a8');
      }
    }
  }

  private stationBadge(scene: Scene, cam: Camera, s: Station, ghost: boolean): void {
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(cam, (s.tile % scene.map.width) + 0.5, ((s.tile / scene.map.width) | 0) + 0.5);
    const size = Math.max(16, Math.min(32, cam.zoom * 0.95));
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.75;
    const owners = s.owners.map((o) => scene.colors.get(o) ?? '#999');
    this.roundRect(sx - size / 2, sy - size / 2, size, size, size * 0.22);
    ctx.fillStyle = owners[0];
    ctx.fill();
    if (owners[1]) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = owners[1];
      ctx.beginPath();
      ctx.moveTo(sx + size / 2, sy - size / 2);
      ctx.lineTo(sx + size / 2, sy + size / 2);
      ctx.lineTo(sx - size / 2, sy + size / 2);
      ctx.fill();
      ctx.restore();
    }
    this.roundRect(sx - size / 2, sy - size / 2, size, size, size * 0.22);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.setLineDash(ghost ? [4, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawGlyph(STATIONS[s.kind].icon, sx, sy, size * 0.62);
    ctx.restore();
    if (cam.zoom >= 22 && !ghost) this.label(s.name, sx, sy - size / 2 - 8, `600 11px ${UI_FONT}`, '#fff');
  }

  private drawStations(scene: Scene, cam: Camera, v: View): void {
    const hide = scene.replay;
    const w = scene.map.width;
    const visible = (s: Station) => {
      const x = s.tile % w;
      const y = (s.tile / w) | 0;
      return x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1;
    };
    for (const s of scene.state.stations) {
      if (!visible(s)) continue;
      if (hide && s.builtTurn === hide.turn && (scene.state.infra.tiles[s.tile]?.slot ?? 0) > hide.slot) continue;
      this.stationBadge(scene, cam, s, false);
    }
    for (const s of scene.plannedStations) if (visible(s)) this.stationBadge(scene, cam, s, true);
  }

  private drawHqs(scene: Scene, cam: Camera): void {
    const ctx = this.ctx;
    const size = Math.max(20, Math.min(40, cam.zoom * 1.2));
    for (const p of scene.state.players) {
      if (p.hq === null) continue;
      const [sx, sy] = this.toScreen(cam, (p.hq % scene.map.width) + 0.5, ((p.hq / scene.map.width) | 0) + 0.5);
      ctx.beginPath();
      ctx.arc(sx, sy, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = p.color;
      ctx.stroke();
      this.drawGlyph('🏢', sx, sy, size * 0.6);
      // Little flag in the owner's colour.
      ctx.fillStyle = p.color;
      ctx.fillRect(sx + size * 0.32, sy - size * 0.72, size * 0.32, size * 0.2);
      ctx.fillRect(sx + size * 0.3, sy - size * 0.72, 2, size * 0.45);
      if (cam.zoom >= 7) this.label(p.name, sx, sy + size / 2 + 9, `700 12px ${UI_FONT}`, '#fff');
    }
  }

  private drawMarker(scene: Scene, cam: Camera, marker: SlotMarker): void {
    let m = marker;
    const ctx = this.ctx;
    const myColor = (scene.me && scene.colors.get(scene.me)) || '#fff';
    if (m.line) {
      // Curved arrow beside the route, so it doesn't hide the planned road or track.
      const [ax, ay] = this.toScreen(cam, m.line[0], m.line[1]);
      const [bx, by] = this.toScreen(cam, m.line[2], m.line[3]);
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const bend = Math.min(60, len * 0.18);
      const cx = (ax + bx) / 2 + (-(by - ay) / len) * bend;
      const cy = (ay + by) / 2 + ((bx - ax) / len) * bend;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(cx, cy, bx, by);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = (m.highlighted ? 4 : 2.5) + 2.5;
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.strokeStyle = myColor;
      ctx.lineWidth = m.highlighted ? 4 : 2.5;
      ctx.stroke();
      ctx.setLineDash([]);
      m = { ...m, x: (ax + 2 * cx + bx) / 4, y: (ay + 2 * cy + by) / 4 };
      const ang = Math.atan2(by - cy, bx - cx);
      const tipX = bx - Math.cos(ang) * 14;
      const tipY = by - Math.sin(ang) * 14;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(ang - 0.45) * 10, tipY - Math.sin(ang - 0.45) * 10);
      ctx.lineTo(tipX - Math.cos(ang + 0.45) * 10, tipY - Math.sin(ang + 0.45) * 10);
      ctx.closePath();
      ctx.fillStyle = myColor;
      ctx.fill();
    }
    if (m.highlighted && m.path) {
      ctx.beginPath();
      m.path.forEach((t, i) => {
        const [x, y] = this.toScreen(cam, (t % scene.map.width) + 0.5, ((t / scene.map.width) | 0) + 0.5);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = Math.max(8, cam.zoom * 0.8);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    const [sx, sy] = m.line ? [m.x, m.y] : this.toScreen(cam, m.x, m.y);
    const r = m.highlighted ? 13 : 11;
    ctx.font = `800 ${m.highlighted ? 14 : 12}px ${UI_FONT}`;
    // A circle for one slot, a pill for a range of slots.
    const w = Math.max(2 * r, ctx.measureText(m.label).width + 12);
    this.roundRect(sx - w / 2, sy - r, w, 2 * r, r);
    ctx.fillStyle = m.status === 'ok' ? myColor : m.status === 'partial' ? '#ff9800' : '#e53935';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.label, sx, sy + 0.5);
  }

  private drawToolScreen(scene: Scene, cam: Camera, tool: ToolOverlay): void {
    const ctx = this.ctx;
    const pos = (t: number) => this.toScreen(cam, (t % scene.map.width) + 0.5, ((t / scene.map.width) | 0) + 0.5);
    if (tool.kind === 'route') {
      if (tool.start !== null) {
        const [x, y] = pos(tool.start);
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#222';
        ctx.stroke();
      }
      const end = tool.path?.[tool.path.length - 1];
      if (tool.label && end !== undefined) {
        const [x, y] = pos(end);
        ctx.font = `700 12px ${UI_FONT}`;
        const w = ctx.measureText(tool.label).width + 14;
        this.roundRect(x + 12, y - 26, w, 22, 6);
        ctx.fillStyle = tool.ok ? 'rgba(20, 30, 38, 0.92)' : 'rgba(150, 90, 20, 0.92)';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tool.label, x + 19, y - 15);
      }
    } else if (tool.kind === 'vehicles') {
      for (const { tile: t, match } of tool.candidates) {
        const [x, y] = pos(t);
        const chosen = t === tool.from || t === tool.to;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(14, cam.zoom * 0.75), 0, Math.PI * 2);
        ctx.strokeStyle = chosen ? '#ffd54a' : match ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = chosen ? 4 : 2;
        ctx.setLineDash(chosen ? [] : [5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  private drawReplayMarks(scene: Scene, cam: Camera, hide: NonNullable<Scene['replay']>): void {
    const ctx = this.ctx;
    for (const t of hide.lostTiles) {
      const [x, y] = this.toScreen(cam, (t % scene.map.width) + 0.5, ((t / scene.map.width) | 0) + 0.5);
      ctx.strokeStyle = '#ff3d3d';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 9);
      ctx.lineTo(x + 9, y + 9);
      ctx.moveTo(x + 9, y - 9);
      ctx.lineTo(x - 9, y + 9);
      ctx.stroke();
    }
    for (const t of hide.sharedTiles) {
      const [x, y] = this.toScreen(cam, (t % scene.map.width) + 0.5, ((t / scene.map.width) | 0) + 0.5);
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd54a';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  private drawTexts(scene: Scene, cam: Camera): void {
    const ctx = this.ctx;
    for (const t of scene.texts) {
      const [x, y] = this.toScreen(cam, t.x, t.y);
      const ty = y - 18 - t.t * 30;
      ctx.globalAlpha = Math.max(0, Math.min(1, (1 - t.t) * 1.6));
      ctx.font = `800 13px ${UI_FONT}`;
      const w = ctx.measureText(t.text).width + 14;
      this.roundRect(x - w / 2, ty - 11, w, 22, 11);
      ctx.fillStyle = 'rgba(12, 18, 24, 0.85)';
      ctx.fill();
      ctx.fillStyle = t.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.text, x, ty + 0.5);
      ctx.globalAlpha = 1;
    }
  }

  private banner(text: string): void {
    const ctx = this.ctx;
    ctx.font = `700 14px ${UI_FONT}`;
    const w = ctx.measureText(text).width + 28;
    const x = this.width / 2 - w / 2;
    this.roundRect(x, 62, w, 30, 15);
    ctx.fillStyle = 'rgba(16, 24, 32, 0.88)';
    ctx.fill();
    ctx.fillStyle = '#ffd54a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, this.width / 2, 77);
  }
}

function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + amount));
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}
