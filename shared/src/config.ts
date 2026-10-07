// Game balance and content definitions. Tweak numbers here; everything else reads from this file.
import { Terrain } from './types';
import type { CargoId, IndustryTypeId, StationKind, TerrainId, TransportKind, VehicleModelId } from './types';

/** Actions (slots) per player per turn; the host can choose between MIN and MAX when creating a game. */
export const DEFAULT_ACTION_SLOTS = 5;
export const MIN_ACTION_SLOTS = 3;
export const MAX_ACTION_SLOTS = 20;
/** Simulation steps per turn. Vehicle speeds are expressed in tiles per turn. */
export const TICKS_PER_TURN = 40;
/** Longest route the route tool plans in one go (it is then built one segment per action). */
export const MAX_ROUTE_EDGES = 64;
export const MAX_VEHICLES_PER_ACTION = 5;
/** Part of the purchase price you get back when selling a vehicle. */
export const VEHICLE_RESALE = 0.5;
/** Per station and cargo type; anything above this waits at the industry instead. */
export const STATION_WAITING_CAP = 400;
export const LOAD_TICKS = 1;
/** Minimum Chebyshev distance between two headquarters. */
export const MIN_HQ_DISTANCE = 6;
export const MARKET_HISTORY_LENGTH = 30;
export const DEFAULT_START_MONEY = 1_500_000;
export const MAP_SIZES = [48, 64, 96] as const;
export const MAX_PLAYERS = 8;
/** Cities pay this fraction of the price for deliveries above their demand in a turn. */
export const OVERSUPPLY_PRICE_FACTOR = 0.4;
/** Number of reports (with replays) kept per game. */
export const REPORTS_KEPT = 20;

export const PLAYER_COLORS = [
  '#e53935',
  '#1e88e5',
  '#fb8c00',
  '#8e24aa',
  '#00acc1',
  '#fdd835',
  '#d81b60',
  '#6d4c41',
] as const;

export interface CargoDef {
  id: CargoId;
  name: string;
  icon: string;
  color: string;
  /** Base revenue in € per unit per tile of (straight line) distance. */
  price: number;
  /** false: the price does not move with the market (passengers). */
  market?: boolean;
}

export const CARGO: Record<CargoId, CargoDef> = {
  grain: { id: 'grain', name: 'Graan', icon: '🌾', color: '#e3c44f', price: 32 },
  logs: { id: 'logs', name: 'Boomstammen', icon: '🪵', color: '#8d5a2b', price: 30 },
  coal: { id: 'coal', name: 'Steenkool', icon: '⚫', color: '#3a3a3a', price: 30 },
  iron_ore: { id: 'iron_ore', name: 'IJzererts', icon: '🟠', color: '#b5562e', price: 34 },
  crude_oil: { id: 'crude_oil', name: 'Ruwe olie', icon: '🛢️', color: '#2b2b40', price: 36 },
  stone: { id: 'stone', name: 'Steen', icon: '🪨', color: '#9a9a9a', price: 28 },
  food: { id: 'food', name: 'Voedsel', icon: '🥫', color: '#d9534f', price: 55 },
  planks: { id: 'planks', name: 'Planken', icon: '🟫', color: '#c49a6c', price: 48 },
  steel: { id: 'steel', name: 'Staal', icon: '🔩', color: '#7d8ea3', price: 65 },
  fuel: { id: 'fuel', name: 'Brandstof', icon: '⛽', color: '#e07b39', price: 62 },
  construction_materials: {
    id: 'construction_materials',
    name: 'Bouwmaterialen',
    icon: '🧱',
    color: '#b4654a',
    price: 56,
  },
  tools: { id: 'tools', name: 'Gereedschap', icon: '🔧', color: '#5b7c99', price: 75 },
  goods: { id: 'goods', name: 'Goederen', icon: '📦', color: '#a0784f', price: 85 },
  passengers: { id: 'passengers', name: 'Passagiers', icon: '👥', color: '#5aa9e6', price: 16, market: false },
};

export const CARGO_IDS = Object.keys(CARGO) as CargoId[];
/** Cargo traded on the market (passengers have a fixed price). */
export const MARKET_CARGO = CARGO_IDS.filter((c) => CARGO[c].market !== false);

/** Cargo that cities can ask for. Every city wants food, the rest is distributed. */
export const CITY_CARGO: CargoId[] = ['food', 'goods', 'fuel', 'tools', 'construction_materials'];

/** Passengers a city produces per turn per inhabitant. They want to travel to another city. */
export const PASSENGERS_PER_INHABITANT = 1 / 40;
/** Passengers waiting in a city are capped at this many turns of production. */
export const CITY_STOCK_TURNS = 3;

export interface IndustryDef {
  id: IndustryTypeId;
  name: string;
  icon: string;
  color: string;
  output: CargoId;
  /** Units of each input needed per unit of output; null for raw (primary) industries. */
  inputs: Partial<Record<CargoId, number>> | null;
  /** Possible production rates (raw) or the processing capacity per turn. */
  rates: number[];
  /** Preferred terrain when placing the industry on the map. */
  terrain: 'grass' | 'forest' | 'hills' | 'any' | 'flat';
  /** Minimum number on a normal (64) map. */
  minCount: number;
}

export const INDUSTRIES: Record<IndustryTypeId, IndustryDef> = {
  farm: {
    id: 'farm',
    name: 'Boerderij',
    icon: '🚜',
    color: '#c9a640',
    output: 'grain',
    inputs: null,
    rates: [40, 50, 60, 70, 80],
    terrain: 'grass',
    minCount: 2,
  },
  forest: {
    id: 'forest',
    name: 'Houtvesterij',
    icon: '🌲',
    color: '#4b7a3a',
    output: 'logs',
    inputs: null,
    rates: [40, 50, 60, 70, 80],
    terrain: 'forest',
    minCount: 2,
  },
  coal_mine: {
    id: 'coal_mine',
    name: 'Kolenmijn',
    icon: '⛏️',
    color: '#4a4a4a',
    output: 'coal',
    inputs: null,
    rates: [50, 60, 70, 80],
    terrain: 'hills',
    minCount: 2,
  },
  iron_mine: {
    id: 'iron_mine',
    name: 'IJzerertsmijn',
    icon: '⚒️',
    color: '#a0522d',
    output: 'iron_ore',
    inputs: null,
    rates: [50, 60, 70, 80],
    terrain: 'hills',
    minCount: 2,
  },
  oil_well: {
    id: 'oil_well',
    name: 'Oliebron',
    icon: '🛢️',
    color: '#333344',
    output: 'crude_oil',
    inputs: null,
    rates: [40, 50, 60, 70],
    terrain: 'any',
    minCount: 1,
  },
  quarry: {
    id: 'quarry',
    name: 'Steengroeve',
    icon: '🪨',
    color: '#8f8f8f',
    output: 'stone',
    inputs: null,
    rates: [40, 50, 60, 70],
    terrain: 'hills',
    minCount: 1,
  },
  food_plant: {
    id: 'food_plant',
    name: 'Voedselfabriek',
    icon: '🥫',
    color: '#c0504d',
    output: 'food',
    inputs: { grain: 1 },
    rates: [120],
    terrain: 'flat',
    minCount: 1,
  },
  sawmill: {
    id: 'sawmill',
    name: 'Zagerij',
    icon: '🪚',
    color: '#a87b4f',
    output: 'planks',
    inputs: { logs: 1 },
    rates: [120],
    terrain: 'flat',
    minCount: 1,
  },
  steel_mill: {
    id: 'steel_mill',
    name: 'Staalfabriek',
    icon: '🏭',
    color: '#6b7b8c',
    output: 'steel',
    inputs: { coal: 1, iron_ore: 1 },
    rates: [120],
    terrain: 'flat',
    minCount: 1,
  },
  refinery: {
    id: 'refinery',
    name: 'Raffinaderij',
    icon: '⚗️',
    color: '#d4793a',
    output: 'fuel',
    inputs: { crude_oil: 1 },
    rates: [120],
    terrain: 'flat',
    minCount: 1,
  },
  cm_plant: {
    id: 'cm_plant',
    name: 'Bouwmaterialenfabriek',
    icon: '🧱',
    color: '#a9583d',
    output: 'construction_materials',
    inputs: { stone: 1 },
    rates: [120],
    terrain: 'flat',
    minCount: 1,
  },
  tools_factory: {
    id: 'tools_factory',
    name: 'Gereedschapsfabriek',
    icon: '🔧',
    color: '#4f6d8a',
    output: 'tools',
    inputs: { planks: 1 },
    rates: [120],
    terrain: 'flat',
    minCount: 1,
  },
  goods_factory: {
    id: 'goods_factory',
    name: 'Goederenfabriek',
    icon: '📦',
    color: '#8b6a45',
    output: 'goods',
    inputs: { steel: 1, planks: 1 },
    rates: [120],
    terrain: 'flat',
    minCount: 1,
  },
};

export const INDUSTRY_IDS = Object.keys(INDUSTRIES) as IndustryTypeId[];

export interface TransportDef {
  id: TransportKind;
  name: string;
  /** € per straight segment on flat land (diagonal segments cost √2 as much). */
  edgeCost: number;
  /** € per segment per turn. */
  upkeep: number;
  /** Station type that can be placed on the ends of a route of this kind. */
  station: StationKind | null;
}

export const TRANSPORT: Record<TransportKind, TransportDef> = {
  road: { id: 'road', name: 'Weg', edgeCost: 2_500, upkeep: 25, station: 'road' },
  rail: { id: 'rail', name: 'Spoor', edgeCost: 6_000, upkeep: 60, station: 'rail' },
  canal: { id: 'canal', name: 'Kanaal', edgeCost: 20_000, upkeep: 100, station: null },
};

export interface StationDef {
  id: StationKind;
  name: string;
  plural: string;
  /** Used to name stations: "<prefix> <place>". */
  prefix: string;
  icon: string;
  cost: number;
  upkeep: number;
  /** Catchment radius (Chebyshev distance) for industries and cities. */
  radius: number;
  /** Network a station of this kind connects to. */
  transport: TransportKind;
}

export const STATIONS: Record<StationKind, StationDef> = {
  road: { id: 'road', name: 'Laadpunt', plural: 'laadpunten', prefix: 'Laadpunt', icon: '🚏', cost: 30_000, upkeep: 1_000, radius: 1, transport: 'road' },
  rail: { id: 'rail', name: 'Treinstation', plural: 'treinstations', prefix: 'Station', icon: '🚉', cost: 90_000, upkeep: 3_000, radius: 1, transport: 'rail' },
  water: { id: 'water', name: 'Haven', plural: 'havens', prefix: 'Haven', icon: '⚓', cost: 100_000, upkeep: 3_000, radius: 2, transport: 'canal' },
};

export interface VehicleModel {
  id: VehicleModelId;
  name: string;
  kind: StationKind;
  /** Freight vehicles carry goods, passenger vehicles carry passengers between cities. */
  carries: 'cargo' | 'passengers';
  icon: string;
  capacity: number;
  /** Tiles per turn. */
  speed: number;
  price: number;
  upkeep: number;
}

export const VEHICLES: Record<VehicleModelId, VehicleModel> = {
  truck: { id: 'truck', name: 'Vrachtwagen', kind: 'road', carries: 'cargo', icon: '🚚', capacity: 20, speed: 40, price: 45_000, upkeep: 4_000 },
  truck_heavy: {
    id: 'truck_heavy',
    name: 'Zware vrachtwagen',
    kind: 'road',
    carries: 'cargo',
    icon: '🚛',
    capacity: 32,
    speed: 32,
    price: 75_000,
    upkeep: 6_000,
  },
  bus: { id: 'bus', name: 'Bus', kind: 'road', carries: 'passengers', icon: '🚌', capacity: 25, speed: 44, price: 50_000, upkeep: 4_000 },
  train_steam: {
    id: 'train_steam',
    name: 'Stoomtrein',
    kind: 'rail',
    carries: 'cargo',
    icon: '🚂',
    capacity: 90,
    speed: 56,
    price: 220_000,
    upkeep: 15_000,
  },
  train_diesel: {
    id: 'train_diesel',
    name: 'Dieseltrein',
    kind: 'rail',
    carries: 'cargo',
    icon: '🚆',
    capacity: 140,
    speed: 88,
    price: 380_000,
    upkeep: 24_000,
  },
  train_passenger: {
    id: 'train_passenger',
    name: 'Passagierstrein',
    kind: 'rail',
    carries: 'passengers',
    icon: '🚄',
    capacity: 120,
    speed: 80,
    price: 280_000,
    upkeep: 18_000,
  },
  barge: {
    id: 'barge',
    name: 'Binnenvaartschip',
    kind: 'water',
    carries: 'cargo',
    icon: '🛥️',
    capacity: 150,
    speed: 22,
    price: 140_000,
    upkeep: 9_000,
  },
  cargo_ship: {
    id: 'cargo_ship',
    name: 'Vrachtschip',
    kind: 'water',
    carries: 'cargo',
    icon: '🚢',
    capacity: 280,
    speed: 30,
    price: 260_000,
    upkeep: 16_000,
  },
  ferry: { id: 'ferry', name: 'Veerboot', kind: 'water', carries: 'passengers', icon: '⛴️', capacity: 120, speed: 30, price: 140_000, upkeep: 9_000 },
};

export const VEHICLE_IDS = Object.keys(VEHICLES) as VehicleModelId[];

export interface TerrainDef {
  name: string;
  /** Cost multiplier for road/rail (water = bridge, mountain = tunnel); null = impossible. */
  land: number | null;
  /** Cost multiplier for canals; 0 = already navigable, null = impossible. */
  canal: number | null;
  /** Can stations/headquarters be built here? */
  buildable: boolean;
}

export const TERRAIN: Record<TerrainId, TerrainDef> = {
  [Terrain.Water]: { name: 'Water', land: 6, canal: 0, buildable: false },
  [Terrain.Sand]: { name: 'Zand', land: 1.2, canal: 1, buildable: true },
  [Terrain.Grass]: { name: 'Gras', land: 1, canal: 1, buildable: true },
  [Terrain.Forest]: { name: 'Bos', land: 1.5, canal: 1.4, buildable: true },
  [Terrain.Hills]: { name: 'Heuvels', land: 2.2, canal: 2.5, buildable: true },
  [Terrain.Mountain]: { name: 'Bergen', land: 4, canal: null, buildable: false },
};

/** Market tuning: how fast prices react and how far they can move. */
export const MARKET = {
  /** Price multiplier when nothing is delivered (scarcity). */
  scarce: 1.3,
  /** Price multiplier drop per 100% of demand delivered. */
  slope: 0.55,
  min: 0.5,
  max: 1.6,
  /** Fraction of the gap to the target closed each turn. */
  reaction: 0.35,
  /** Random noise amplitude per turn. */
  noise: 0.02,
};

/** Headquarters: deliveries on a line whose two stations both lie within `radius` tiles (Chebyshev) get a bonus. */
export const HQ_BONUS = {
  radius: 10,
  bonus: 0.25,
};

/** Loans: free actions, taken and repaid in steps; interest is charged every turn. */
export const LOANS = {
  step: 250_000,
  /** Interest per turn on the outstanding debt. */
  rate: 0.02,
  /** Credit limit = base + bookFactor × book value of vehicles, stations and infrastructure. */
  base: 500_000,
  bookFactor: 0.5,
  /** Book value as a fraction of what things cost. */
  bookValue: 0.5,
};

/** Auctions of industry shares: free actions. */
export const AUCTIONS = {
  /** Auctions start after this many turns. */
  startAfterTurn: 10,
  /** At most this many auctions run at the same time; when one ends, a new one starts. */
  maxOpen: 3,
  sharesPerIndustry: 10,
  /** A new bid must be at least this much higher than the current one. */
  minIncrement: 0.05,
  /** An auction without bids closes after this many turns. */
  expireTurns: 3,
  /** Part of other players' revenue from an industry's cargo that goes to each share. */
  tollPerShare: 0.03,
  /** With this many shares you decide who may pick up cargo at the industry. */
  majority: 6,
  /** Starting price = production per turn × cargo price × this factor. */
  minBidFactor: 8,
};
