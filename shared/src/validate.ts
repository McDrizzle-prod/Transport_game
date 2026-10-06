// Sanitising orders received from clients. Only the shape is checked here; the game rules are
// applied when the turn is resolved (the world may change before then).
import { ACTION_SLOTS, MAX_ROUTE_EDGES, MAX_VEHICLES_PER_ACTION, VEHICLES } from './config';
import { isAdjacent, validTile } from './geometry';
import type { Grid } from './geometry';
import type { Action, MapData, OrderSlots, StationKind, TransportKind, VehicleModelId } from './types';

const TRANSPORT_KINDS: readonly string[] = ['road', 'rail', 'canal'] satisfies TransportKind[];
const STATION_KINDS: readonly string[] = ['road', 'rail', 'water'] satisfies StationKind[];

export type SanitizeResult = { ok: true; slots: OrderSlots } | { ok: false; error: string };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function sanitizeAction(grid: Grid, raw: unknown): Action | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case 'build': {
      if (typeof r.kind !== 'string' || !TRANSPORT_KINDS.includes(r.kind)) return null;
      const path = r.path;
      if (!Array.isArray(path) || path.length < 2 || path.length > MAX_ROUTE_EDGES + 1) return null;
      const seen = new Set<number>();
      for (let i = 0; i < path.length; i++) {
        const t: unknown = path[i];
        if (!isInt(t) || !validTile(grid, t) || seen.has(t)) return null;
        if (i > 0 && !isAdjacent(grid, path[i - 1] as number, t)) return null;
        seen.add(t);
      }
      return {
        type: 'build',
        kind: r.kind as TransportKind,
        path: path as number[],
        stationStart: r.stationStart === true,
        stationEnd: r.stationEnd === true,
      };
    }
    case 'station': {
      if (typeof r.kind !== 'string' || !STATION_KINDS.includes(r.kind)) return null;
      if (!isInt(r.tile) || !validTile(grid, r.tile)) return null;
      return { type: 'station', kind: r.kind as StationKind, tile: r.tile };
    }
    case 'vehicles': {
      if (typeof r.model !== 'string' || !(r.model in VEHICLES)) return null;
      if (!isInt(r.from) || !validTile(grid, r.from) || !isInt(r.to) || !validTile(grid, r.to)) return null;
      if (!isInt(r.count) || r.count < 1 || r.count > MAX_VEHICLES_PER_ACTION) return null;
      return { type: 'vehicles', model: r.model as VehicleModelId, from: r.from, to: r.to, count: r.count };
    }
    case 'sell': {
      if (!isInt(r.line) || r.line < 1) return null;
      if (!isInt(r.count) || r.count < 1 || r.count > MAX_VEHICLES_PER_ACTION) return null;
      return { type: 'sell', line: r.line, count: r.count };
    }
    default:
      return null;
  }
}

export function sanitizeOrders(map: MapData, input: unknown): SanitizeResult {
  if (!Array.isArray(input) || input.length > ACTION_SLOTS) return { ok: false, error: 'slots_invalid' };
  const grid = { width: map.width, height: map.height };
  const slots: OrderSlots = [];
  for (let i = 0; i < ACTION_SLOTS; i++) {
    const raw: unknown = input[i];
    if (raw === null || raw === undefined) {
      slots.push(null);
      continue;
    }
    const action = sanitizeAction(grid, raw);
    if (!action) return { ok: false, error: `slot_${i + 1}_invalid` };
    slots.push(action);
  }
  return { ok: true, slots };
}

export function emptySlots(): OrderSlots {
  return Array.from({ length: ACTION_SLOTS }, () => null);
}
