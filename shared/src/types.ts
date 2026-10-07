// Core data model. Everything here is plain JSON so it can be stored on disk and sent to clients.

export type PlayerId = string;

export const Terrain = {
  Water: 0,
  Sand: 1,
  Grass: 2,
  Forest: 3,
  Hills: 4,
  Mountain: 5,
} as const;
export type TerrainId = (typeof Terrain)[keyof typeof Terrain];

/** What occupies a tile from the start of the game (cities and industries never move). */
export const TileUse = {
  None: 0,
  CityBuilding: 1,
  CityStreet: 2,
  Industry: 3,
} as const;
export type TileUseId = (typeof TileUse)[keyof typeof TileUse];

export type TransportKind = 'road' | 'rail' | 'canal';
export type StationKind = 'road' | 'rail' | 'water';

export type CargoId =
  | 'grain'
  | 'logs'
  | 'coal'
  | 'iron_ore'
  | 'crude_oil'
  | 'stone'
  | 'food'
  | 'planks'
  | 'steel'
  | 'fuel'
  | 'construction_materials'
  | 'tools'
  | 'goods'
  | 'passengers';

export type IndustryTypeId =
  | 'farm'
  | 'forest'
  | 'coal_mine'
  | 'iron_mine'
  | 'oil_well'
  | 'quarry'
  | 'food_plant'
  | 'sawmill'
  | 'steel_mill'
  | 'refinery'
  | 'cm_plant'
  | 'tools_factory'
  | 'goods_factory';

export type VehicleModelId =
  | 'truck'
  | 'truck_heavy'
  | 'bus'
  | 'train_steam'
  | 'train_diesel'
  | 'train_passenger'
  | 'barge'
  | 'cargo_ship'
  | 'ferry';

export type CargoAmounts = Partial<Record<CargoId, number>>;

// ---------------------------------------------------------------------------
// Map (static after generation)

export interface City {
  id: number;
  name: string;
  /** Centre tile. */
  x: number;
  y: number;
  radius: number;
  population: number;
  /** All tiles (buildings + streets) that belong to the city. */
  tiles: number[];
  /** Units per turn the city wants to receive at full price. */
  demand: CargoAmounts;
}

export interface MapData {
  width: number;
  height: number;
  seed: number;
  /** TerrainId per tile, row-major. */
  terrain: number[];
  /** 0..255 per tile, used for rendering relief. */
  elevation: number[];
  /** TileUseId per tile. */
  use: number[];
  cities: City[];
}

// ---------------------------------------------------------------------------
// Dynamic game state

export interface Industry {
  id: number;
  type: IndustryTypeId;
  name: string;
  /** Footprint (top-left corner + size in tiles). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Raw industries: units produced per turn. Processing industries: max output per turn. */
  rate: number;
  /** Output waiting to be picked up. */
  stock: number;
  /** Input stock of processing industries. */
  input: CargoAmounts;
  /** Statistics of the last resolved turn. */
  stats: { produced: number; shipped: number; received: CargoAmounts };
  /** Shares (of 10) owned by players; the rest belongs to the bank. */
  shares: Record<PlayerId, number>;
}

export interface TileInfra {
  /** Players that control this tile. Several owners = shared tile (built in the same slot). */
  owners: PlayerId[];
  station?: number;
  /** When the tile was claimed (used in reports to explain conflicts). */
  turn: number;
  slot: number;
}

export interface Edge {
  kind: TransportKind;
  a: number;
  b: number;
  owners: PlayerId[];
  turn: number;
  slot: number;
}

export interface InfraState {
  tiles: Record<string, TileInfra>;
  edges: Record<string, Edge>;
}

export interface CargoLot {
  cargo: CargoId;
  amount: number;
  /**
   * Where the cargo came from (revenue is based on the distance from there): an industry id,
   * or a city id for passengers.
   */
  origin: number;
}

export interface Station {
  id: number;
  kind: StationKind;
  tile: number;
  owners: PlayerId[];
  name: string;
  waiting: CargoLot[];
  builtTurn: number;
}

export interface LineStats {
  trips: number;
  revenue: number;
  delivered: CargoAmounts;
}

export interface Line {
  id: number;
  owner: PlayerId;
  kind: StationKind;
  /** Freight lines and passenger lines between the same stations are separate lines. */
  carries: 'cargo' | 'passengers';
  stations: [number, number];
  name: string;
  createdTurn: number;
  /** Length in tiles of the route found during the last turn, or null when there was no connection. */
  length: number | null;
  stats: LineStats;
}

export interface Vehicle {
  id: number;
  owner: PlayerId;
  model: VehicleModelId;
  lineId: number;
  /** 0: (departing from / travelling away from) stations[0]; 1: same for stations[1]. */
  dir: 0 | 1;
  state: 'loading' | 'moving' | 'blocked';
  /** Tiles travelled on the current trip. */
  progress: number;
  /** Remaining loading ticks. */
  wait: number;
  cargo: CargoLot[];
  boughtTurn: number;
  stats: { trips: number; revenue: number; revenueTotal: number };
}

export interface Finance {
  start: number;
  construction: number;
  vehicles: number;
  /** Earned with deliveries, including the headquarters bonus (before tolls). */
  revenue: number;
  /** Paid out of that revenue to shareholders of the industries the cargo came from. */
  tolls: number;
  /** Received as a shareholder from other players' deliveries. */
  dividends: number;
  upkeep: number;
  interest: number;
  end: number;
}

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  money: number;
  hq: number | null;
  isHost: boolean;
  joinedAt: number;
  last: Finance | null;
  /** Outstanding loans. */
  debt: number;
}

export type TurnSchedule =
  | { mode: 'daily'; time: string; timeZone: string }
  | { mode: 'interval'; minutes: number }
  | { mode: 'manual' };

export interface GameSettings {
  mapSize: number;
  seed: number;
  maxPlayers: number;
  startMoney: number;
  schedule: TurnSchedule;
  /** Resolve the turn early as soon as every player has marked their orders as ready. */
  resolveWhenAllReady: boolean;
  /** Number of actions (slots) per player per turn. */
  actionSlots: number;
}

export interface MarketState {
  /** Price multiplier per cargo (1 = base price). */
  prices: Record<CargoId, number>;
  history: Record<CargoId, number[]>;
  /** Units delivered map-wide last turn. */
  supply: CargoAmounts;
  /** Units per turn wanted map-wide (cities + processing industries). */
  demand: CargoAmounts;
}

export interface Alliance {
  id: number;
  name: string;
  members: PlayerId[];
  formedTurn: number;
}

export interface AllianceInvite {
  from: PlayerId;
  to: PlayerId;
  at: number;
}

export interface Bid {
  player: PlayerId;
  amount: number;
  /** Turn during which the bid was placed. */
  turn: number;
  at: number;
}

/** Auction of one share (10%) of an industry. The money of the highest bid is reserved. */
export interface Auction {
  id: number;
  industry: number;
  openedTurn: number;
  minBid: number;
  bids: Bid[];
  status: 'open' | 'sold' | 'expired';
  closedTurn?: number;
}

export type GamePhase = 'lobby' | 'running' | 'finished';

export interface GameState {
  id: string;
  name: string;
  createdAt: number;
  phase: GamePhase;
  /** Turn currently being planned (1 = first turn). */
  turn: number;
  /** When the current turn will be executed (epoch ms), null = only manually. */
  deadline: number | null;
  lastResolvedAt: number | null;
  settings: GameSettings;
  players: Player[];
  industries: Industry[];
  /** Deliveries per city during the last turn. */
  cityStats: Record<string, CargoAmounts>;
  /** Passengers waiting in each city for transport. */
  cityStock: Record<string, number>;
  infra: InfraState;
  stations: Station[];
  lines: Line[];
  vehicles: Vehicle[];
  market: MarketState;
  /** Allied players may use each other's roads, tracks, canals and stations. */
  alliances: Alliance[];
  invites: AllianceInvite[];
  auctions: Auction[];
  nextId: number;
}

// ---------------------------------------------------------------------------
// Orders (the action slots)

export interface BuildAction {
  type: 'build';
  kind: TransportKind;
  /** Consecutive (8-neighbour) tiles. Players build one segment (two tiles) per action. */
  path: number[];
  stationStart?: boolean;
  stationEnd?: boolean;
}

export interface StationAction {
  type: 'station';
  kind: StationKind;
  tile: number;
}

export interface VehicleAction {
  type: 'vehicles';
  model: VehicleModelId;
  /** Tiles of the two stations (they may be built earlier in the same turn). */
  from: number;
  to: number;
  count: number;
}

export interface SellAction {
  type: 'sell';
  /** Line whose vehicles are sold. */
  line: number;
  count: number;
}

export type Action = BuildAction | StationAction | VehicleAction | SellAction;
export type OrderSlots = (Action | null)[];

export interface PlayerOrders {
  slots: OrderSlots;
  ready: boolean;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Turn report

/** Machine readable message; clients translate `code` into text. */
export interface Msg {
  code: string;
  [key: string]: unknown;
}

export type ActionOutcome = 'ok' | 'partial' | 'failed';

export interface LostTile {
  tile: number;
  /** Who holds the tile. */
  owners: PlayerId[];
  /** Turn/slot in which the holder claimed it. */
  turn: number;
  slot: number;
}

export interface SlotResult {
  slot: number;
  player: PlayerId;
  action: Action;
  outcome: ActionOutcome;
  cost: number;
  messages: Msg[];
  /** Edge keys that were built. */
  built: string[];
  stations: number[];
  lost: LostTile[];
  /** Tiles that ended up shared with other players (same slot). */
  shared: { tile: number; with: PlayerId[] }[];
  vehicles: number[];
  lineId?: number;
}

export interface Delivery {
  player: PlayerId;
  lineId: number;
  cargo: CargoId;
  amount: number;
  /** Revenue including the headquarters bonus, before tolls. */
  revenue: number;
  /** Part of the revenue that is headquarters bonus. */
  bonus: number;
  /** Paid to shareholders of the industry the cargo came from. */
  toll: number;
  trips: number;
}

export interface ReplayVehicle {
  id: number;
  owner: PlayerId;
  model: VehicleModelId;
  /** x0, y0, x1, y1, ... for tick 0..ticks (tile coordinates of the vehicle centre). */
  frames: number[];
}

export interface ReplayEvent {
  tick: number;
  vehicle: number;
  player: PlayerId;
  x: number;
  y: number;
  cargo: CargoId;
  amount: number;
  revenue: number;
}

export interface AuctionResult {
  auction: number;
  industry: number;
  status: 'opened' | 'sold' | 'expired';
  winner?: PlayerId;
  price?: number;
}

export interface TurnReport {
  turn: number;
  resolvedAt: number;
  slots: SlotResult[];
  finances: Record<PlayerId, Finance>;
  deliveries: Delivery[];
  /** Auctions that were closed (at the start) or opened (at the end) of this turn. */
  auctions: AuctionResult[];
  market: { cargo: CargoId; before: number; after: number; supplied: number; demand: number }[];
  replay: { ticks: number; vehicles: ReplayVehicle[]; events: ReplayEvent[] };
}
