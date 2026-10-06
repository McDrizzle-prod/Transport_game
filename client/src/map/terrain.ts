// Pre-renders the static part of the map (relief, water, forests, cities, industry buildings) once.
import { Terrain, TileUse } from '@transport/shared';
import type { Industry, MapData } from '@transport/shared';
import { INFRA, ROOFS, TERRAIN_RGB, hash01, mix } from './palette';
import type { RGB } from './palette';

export interface TerrainLayer {
  canvas: HTMLCanvasElement;
  /** Pixels per tile in the layer. */
  px: number;
}

const MAX_LAYER_SIZE = 2304;

export function buildTerrainLayer(map: MapData, industries: Industry[]): TerrainLayer {
  const { width: W, height: H } = map;
  const px = Math.max(12, Math.min(40, Math.floor(MAX_LAYER_SIZE / Math.max(W, H))));
  const canvas = document.createElement('canvas');
  canvas.width = W * px;
  canvas.height = H * px;
  const ctx = canvas.getContext('2d')!;

  const isWater = (i: number) => map.terrain[i] === Terrain.Water;
  const at = (x: number, y: number) => Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x));

  // Distance (in tiles) of water tiles to the nearest land, for depth colouring.
  const depth = new Float32Array(W * H).fill(0);
  {
    const queue: number[] = [];
    for (let i = 0; i < W * H; i++) {
      if (isWater(i)) depth[i] = Infinity;
      else queue.push(i);
    }
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const x = i % W;
      const y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (depth[n] > depth[i] + 1) {
          depth[n] = depth[i] + 1;
          queue.push(n);
        }
      }
    }
  }

  const landColor = (i: number): RGB => {
    const e = map.elevation[i] / 255;
    const r = hash01(i);
    switch (map.terrain[i]) {
      case Terrain.Sand:
        return mix(TERRAIN_RGB.sand, [230, 216, 170], r * 0.5);
      case Terrain.Forest:
        return mix(TERRAIN_RGB.forestFloor, TERRAIN_RGB.grass, r * 0.3);
      case Terrain.Hills:
        return mix(TERRAIN_RGB.hills, TERRAIN_RGB.hillsDry, r * 0.6);
      case Terrain.Mountain:
        // Rock, turning into snow on the highest peaks.
        return mix(mix(TERRAIN_RGB.mountain, TERRAIN_RGB.peak, (e - 0.82) / 0.14), [250, 250, 252], (e - 0.93) / 0.05);
      case Terrain.Water:
        return TERRAIN_RGB.sand;
      default:
        return mix(TERRAIN_RGB.grass, TERRAIN_RGB.grassLight, r * 0.55 + (e - 0.3) * 0.5);
    }
  };

  // --- 1. Smooth land colours with hill shading (1 px per tile, scaled up with smoothing).
  const small = document.createElement('canvas');
  small.width = W;
  small.height = H;
  const sctx = small.getContext('2d')!;
  const land = sctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const ev = (xx: number, yy: number) => map.elevation[at(xx, yy)];
      const slope = ev(x + 1, y) - ev(x - 1, y) + (ev(x, y + 1) - ev(x, y - 1));
      const shade = Math.max(0.72, Math.min(1.28, 1 + slope * 0.0065));
      let c = landColor(i);
      if (isWater(i)) {
        // Under the water: take the colour of a land neighbour so the coast blends nicely.
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = at(x + dx, y + dy);
          if (!isWater(n)) {
            c = landColor(n);
            break;
          }
        }
      }
      const k = isWater(i) ? 1 : shade;
      land.data[i * 4] = c[0] * k;
      land.data[i * 4 + 1] = c[1] * k;
      land.data[i * 4 + 2] = c[2] * k;
      land.data[i * 4 + 3] = 255;
    }
  }
  sctx.putImageData(land, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, W * px, H * px);

  // --- 2. Water with rounded shores, coloured by depth.
  const water = sctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const d = isWater(i) ? Math.min(1, (depth[i] - 1) / 4) : 0;
    const c = mix(TERRAIN_RGB.waterShallow, TERRAIN_RGB.waterDeep, d);
    water.data[i * 4] = c[0];
    water.data[i * 4 + 1] = c[1];
    water.data[i * 4 + 2] = c[2];
    water.data[i * 4 + 3] = 255;
  }
  sctx.putImageData(water, 0, 0);

  const waterPath = new Path2D();
  for (let i = 0; i < W * H; i++) {
    if (!isWater(i)) continue;
    const x = i % W;
    const y = (i / W) | 0;
    const cx = (x + 0.5) * px;
    const cy = (y + 0.5) * px;
    waterPath.moveTo(cx + px * 0.62, cy);
    waterPath.arc(cx, cy, px * 0.62, 0, Math.PI * 2);
    // Connect diagonal neighbours so diagonal channels stay connected.
    for (const [dx, dy] of [[1, 1], [-1, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= W || ny >= H || !isWater(ny * W + nx)) continue;
      const mx = cx + (dx * px) / 2;
      const my = cy + (dy * px) / 2;
      waterPath.moveTo(mx + px * 0.45, my);
      waterPath.arc(mx, my, px * 0.45, 0, Math.PI * 2);
    }
  }
  ctx.save();
  ctx.strokeStyle = 'rgba(236, 226, 186, 0.55)';
  ctx.lineWidth = px * 0.3;
  ctx.stroke(waterPath);
  ctx.clip(waterPath);
  ctx.drawImage(small, 0, 0, W * px, H * px);
  // Gentle ripples.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = Math.max(1, px * 0.05);
  for (let i = 0; i < W * H; i++) {
    if (!isWater(i) || hash01(i, 7) > 0.18) continue;
    const x = (i % W) + 0.2 + hash01(i, 8) * 0.5;
    const y = ((i / W) | 0) + 0.3 + hash01(i, 9) * 0.4;
    ctx.beginPath();
    ctx.moveTo(x * px, y * px);
    ctx.quadraticCurveTo((x + 0.15) * px, (y - 0.08) * px, (x + 0.3) * px, y * px);
    ctx.stroke();
  }
  ctx.restore();

  // --- 3. Trees, rocks.
  const tree = (x: number, y: number, r: number, seed: number) => {
    ctx.fillStyle = 'rgba(20, 40, 10, 0.28)';
    ctx.beginPath();
    ctx.arc((x + r * 0.35) * px, (y + r * 0.4) * px, r * px, 0, Math.PI * 2);
    ctx.fill();
    const g = 0.85 + hash01(seed, 3) * 0.3;
    ctx.fillStyle = `rgb(${52 * g}, ${92 * g}, ${40 * g})`;
    ctx.beginPath();
    ctx.arc(x * px, y * px, r * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(150, 190, 100, 0.35)`;
    ctx.beginPath();
    ctx.arc((x - r * 0.3) * px, (y - r * 0.3) * px, r * 0.5 * px, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let i = 0; i < W * H; i++) {
    const t = map.terrain[i];
    if (map.use[i] !== TileUse.None) continue;
    const x = i % W;
    const y = (i / W) | 0;
    if (t === Terrain.Forest) {
      const n = 3 + Math.floor(hash01(i, 1) * 3);
      for (let k = 0; k < n; k++) {
        tree(x + 0.15 + hash01(i, 10 + k) * 0.7, y + 0.15 + hash01(i, 20 + k) * 0.7, 0.17 + hash01(i, 30 + k) * 0.1, i * 7 + k);
      }
    } else if ((t === Terrain.Grass || t === Terrain.Hills) && hash01(i, 2) < 0.07) {
      tree(x + 0.2 + hash01(i, 11) * 0.6, y + 0.2 + hash01(i, 12) * 0.6, 0.14, i);
    } else if (t === Terrain.Mountain) {
      ctx.fillStyle = 'rgba(90, 82, 72, 0.35)';
      for (let k = 0; k < 2; k++) {
        const rx = x + 0.2 + hash01(i, 40 + k) * 0.6;
        const ry = y + 0.25 + hash01(i, 50 + k) * 0.5;
        ctx.beginPath();
        ctx.moveTo(rx * px, (ry - 0.14) * px);
        ctx.lineTo((rx + 0.16) * px, (ry + 0.1) * px);
        ctx.lineTo((rx - 0.16) * px, (ry + 0.1) * px);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // --- 4. Cities: streets then buildings.
  const isStreet = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && map.use[y * W + x] === TileUse.CityStreet;
  const streetPass = (width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * px;
    ctx.lineCap = 'square';
    ctx.beginPath();
    for (let i = 0; i < W * H; i++) {
      if (map.use[i] !== TileUse.CityStreet) continue;
      const x = i % W;
      const y = (i / W) | 0;
      const cx = (x + 0.5) * px;
      const cy = (y + 0.5) * px;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 0.001, cy);
      if (isStreet(x + 1, y)) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + px, cy);
      }
      if (isStreet(x, y + 1)) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy + px);
      }
    }
    ctx.stroke();
  };
  streetPass(0.56, INFRA.streetCasing);
  streetPass(0.4, INFRA.street);

  for (const city of map.cities) {
    for (const i of city.tiles) {
      if (map.use[i] !== TileUse.CityBuilding) continue;
      const x = i % W;
      const y = (i / W) | 0;
      const central = Math.hypot(x - city.x, y - city.y) < city.radius * 0.5;
      const parts = hash01(i, 60) < 0.45 ? 1 : 2;
      const boxes: [number, number, number, number][] =
        parts === 1
          ? [[0.14, 0.14, 0.72, 0.72]]
          : hash01(i, 61) < 0.5
            ? [
                [0.1, 0.12, 0.38, 0.76],
                [0.54, 0.12, 0.36, 0.76],
              ]
            : [
                [0.12, 0.1, 0.76, 0.38],
                [0.12, 0.54, 0.76, 0.36],
              ];
      boxes.forEach(([bx, by, bw, bh], k) => {
        const roof = central && hash01(i, 70 + k) < 0.6 ? (hash01(i, 71) < 0.5 ? '#7c838c' : '#5f666f') : ROOFS[Math.floor(hash01(i, 72 + k) * ROOFS.length)];
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.fillRect((x + bx + 0.06) * px, (y + by + 0.07) * px, bw * px, bh * px);
        ctx.fillStyle = roof;
        ctx.fillRect((x + bx) * px, (y + by) * px, bw * px, bh * px);
        // Roof ridge for a little depth.
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
        ctx.lineWidth = Math.max(1, px * 0.04);
        ctx.beginPath();
        if (bw >= bh) {
          ctx.moveTo((x + bx) * px, (y + by + bh / 2) * px);
          ctx.lineTo((x + bx + bw) * px, (y + by + bh / 2) * px);
        } else {
          ctx.moveTo((x + bx + bw / 2) * px, (y + by) * px);
          ctx.lineTo((x + bx + bw / 2) * px, (y + by + bh) * px);
        }
        ctx.stroke();
      });
    }
  }

  // --- 5. Industry buildings.
  for (const ind of industries) drawIndustry(ctx, ind, px);

  return { canvas, px };
}

function rect(ctx: CanvasRenderingContext2D, px: number, x: number, y: number, w: number, h: number, fill: string, shadow = true) {
  if (shadow) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect((x + 0.06) * px, (y + 0.07) * px, w * px, h * px);
  }
  ctx.fillStyle = fill;
  ctx.fillRect(x * px, y * px, w * px, h * px);
}

function circle(ctx: CanvasRenderingContext2D, px: number, x: number, y: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x * px, y * px, r * px, 0, Math.PI * 2);
  ctx.fill();
}

function drawIndustry(ctx: CanvasRenderingContext2D, ind: Industry, px: number): void {
  const { x, y, w, h } = ind;
  const pad = (color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect((x + 0.08) * px, (y + 0.08) * px, (w - 0.16) * px, (h - 0.16) * px);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = Math.max(1, px * 0.04);
    ctx.strokeRect((x + 0.08) * px, (y + 0.08) * px, (w - 0.16) * px, (h - 0.16) * px);
  };
  switch (ind.type) {
    case 'farm': {
      // Fields with crop rows, a barn and a silo.
      ctx.fillStyle = '#c9b25a';
      ctx.fillRect((x + 0.05) * px, (y + 0.05) * px, (w - 0.1) * px, (h - 0.1) * px);
      ctx.strokeStyle = 'rgba(120, 140, 50, 0.6)';
      ctx.lineWidth = Math.max(1, px * 0.06);
      ctx.beginPath();
      for (let k = 0.2; k < h; k += 0.22) {
        ctx.moveTo((x + 0.1) * px, (y + k) * px);
        ctx.lineTo((x + w * 0.55) * px, (y + k) * px);
      }
      ctx.stroke();
      rect(ctx, px, x + 1.15, y + 0.3, 0.6, 0.75, '#a33b2c');
      circle(ctx, px, x + 1.45, y + 1.5, 0.22, '#c8c8c8');
      break;
    }
    case 'forest': {
      pad('#9c8559');
      for (let k = 0; k < 3; k++) {
        rect(ctx, px, x + 0.3, y + 0.35 + k * 0.32, 0.9, 0.22, '#7a4f2a');
        for (let j = 0; j < 4; j++) circle(ctx, px, x + 0.36 + j * 0.24, y + 0.46 + k * 0.32, 0.08, '#c89a62');
      }
      rect(ctx, px, x + 1.3, y + 1.2, 0.5, 0.5, '#6d5640');
      break;
    }
    case 'coal_mine':
    case 'iron_mine': {
      pad('#8d8576');
      circle(ctx, px, x + 0.7, y + 1.2, 0.5, ind.type === 'coal_mine' ? '#2e2e2e' : '#7c4a30');
      rect(ctx, px, x + 1.15, y + 0.3, 0.55, 0.6, '#5d6670');
      ctx.strokeStyle = '#3b3b3b';
      ctx.lineWidth = Math.max(1, px * 0.07);
      ctx.beginPath();
      ctx.moveTo((x + 0.45) * px, (y + 0.75) * px);
      ctx.lineTo((x + 0.7) * px, (y + 0.25) * px);
      ctx.lineTo((x + 0.95) * px, (y + 0.75) * px);
      ctx.stroke();
      break;
    }
    case 'oil_well': {
      pad('#b5a98e');
      circle(ctx, px, x + 1.35, y + 1.3, 0.38, '#d9d4c7');
      circle(ctx, px, x + 1.35, y + 1.3, 0.28, '#b8b2a3');
      ctx.strokeStyle = '#242424';
      ctx.lineWidth = Math.max(1, px * 0.09);
      ctx.beginPath();
      ctx.moveTo((x + 0.3) * px, (y + 0.6) * px);
      ctx.lineTo((x + 1.0) * px, (y + 0.35) * px);
      ctx.moveTo((x + 0.65) * px, (y + 0.5) * px);
      ctx.lineTo((x + 0.65) * px, (y + 0.95) * px);
      ctx.stroke();
      break;
    }
    case 'quarry': {
      pad('#a9a39a');
      for (let k = 0; k < 3; k++) {
        const s = 0.75 - k * 0.2;
        ctx.fillStyle = ['#8f8a82', '#77726b', '#5f5b55'][k];
        ctx.fillRect((x + 1 - s) * px, (y + 1 - s) * px, s * 2 * px, s * 2 * px);
      }
      break;
    }
    default: {
      // Processing plants: big hall, a smaller building and a chimney.
      pad('#bdb6a8');
      const roof = industryRoof(ind.type);
      rect(ctx, px, x + 0.2, y + 0.25, 1.05, 0.95, roof);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect((x + 0.2) * px, (y + 0.25) * px, 1.05 * px, 0.3 * px);
      rect(ctx, px, x + 0.3, y + 1.35, 0.9, 0.4, '#8f8b84');
      if (ind.type === 'refinery') {
        circle(ctx, px, x + 1.55, y + 0.6, 0.25, '#e2ddd2');
        circle(ctx, px, x + 1.55, y + 1.3, 0.25, '#e2ddd2');
      } else {
        circle(ctx, px, x + 1.55, y + 0.55, 0.16, '#3b3b3b');
        rect(ctx, px, x + 1.35, y + 1.0, 0.45, 0.7, '#7c766d');
      }
      break;
    }
  }
}

function industryRoof(type: Industry['type']): string {
  switch (type) {
    case 'food_plant':
      return '#c0504d';
    case 'sawmill':
      return '#9a6a3f';
    case 'steel_mill':
      return '#5d6d7e';
    case 'refinery':
      return '#c8742f';
    case 'cm_plant':
      return '#9c4f36';
    case 'tools_factory':
      return '#4f6d8a';
    case 'goods_factory':
      return '#7a5c3c';
    default:
      return '#777';
  }
}
