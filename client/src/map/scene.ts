// Data the renderer needs for one frame. Built by the map controller from the store.
import type { Edge, GameState, MapData, Station, StationKind, TransportKind, VehicleModelId } from '@transport/shared';

export interface VehicleSprite {
  id: number;
  owner: string;
  model: VehicleModelId;
  kind: StationKind;
  x: number;
  y: number;
  angle: number;
  loaded: boolean;
}

export interface SlotMarker {
  /** Slot number, or a range ("2–9") for a route planned as several actions. */
  label: string;
  x: number;
  y: number;
  status: 'ok' | 'partial' | 'failed';
  highlighted: boolean;
  /** For vehicle actions: arrow between the two stations. */
  line?: [number, number, number, number];
  path?: number[];
  kind?: TransportKind;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  /** 0..1 progress of the animation. */
  t: number;
}

export type ToolOverlay =
  | {
      kind: 'route';
      transport: TransportKind;
      /** The tapped points (the first is the start). */
      points: number[];
      /** The route so far (at least one segment). */
      path: number[] | null;
      /** With a mouse: what the next click would add (from the end of the route to the pointer). */
      ghost: number[] | null;
      blocked: number[];
      label: string | null;
      ok: boolean;
    }
  | { kind: 'station'; station: StationKind; tile: number | null; ok: boolean; radius: number; covered: number[] }
  | {
      kind: 'vehicles';
      from: number | null;
      to: number | null;
      hover: number | null;
      /** Stations the player may use; `match`: fits the chosen vehicle. */
      candidates: { tile: number; match: boolean }[];
    }
  | { kind: 'hq'; hover: number | null; ok: boolean; others: number[] };

export interface ReplayView {
  /** Hide infrastructure of this turn built in a later slot than `slot`. */
  turn: number;
  slot: number;
  /** Slot that is currently being revealed (highlighted), or null in the vehicle phase. */
  activeSlot: number | null;
  lostTiles: number[];
  sharedTiles: number[];
  label: string;
}

/** Size on screen (px) of a station badge at a zoom level (pixels per tile). */
export const stationBadgeSize = (zoom: number): number => Math.max(16, Math.min(32, zoom * 0.95));

export interface Scene {
  map: MapData;
  state: GameState;
  me: string | null;
  colors: Map<string, string>;
  plannedEdges: Edge[];
  plannedStations: Station[];
  markers: SlotMarker[];
  tool: ToolOverlay | null;
  selection: number | null;
  hover: number | null;
  vehicles: VehicleSprite[];
  texts: FloatingText[];
  replay: ReplayView | null;
  showGrid: boolean;
  /** The player's headquarters bonus area. */
  hqZone: { tile: number; radius: number; color: string; label: string } | null;
  /** Shares the player owns per industry (green glow). */
  myShares: Map<number, number>;
  /** Industries where another company (not an ally) has the majority: the player can't load there. */
  locked: Set<number>;
  /** Industries with a running share auction. */
  auctions: Set<number>;
  /** A tile or industry lighting up after jumping to it from a list; `t` runs from 0 to 1. */
  flash: { tile: number; t: number } | null;
}
