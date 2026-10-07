// Turn resolution: executes the action slots of all players in order, then simulates the turn.
import { closeAuctions, openAuctions } from './auctions';
import { DEFAULT_ACTION_SLOTS, TICKS_PER_TURN } from './config';
import { executeSlot } from './construction';
import type { SlotEntry } from './construction';
import { chargeInterest } from './finance';
import { marketDemand, updateMarket } from './market';
import { Rng, hashSeed } from './rng';
import { chargeUpkeep, simulateTurn } from './simulation';
import type { Finance, GameState, MapData, OrderSlots, PlayerId, SlotResult, TurnReport } from './types';
import { World } from './world';

/** Deep copy of plain JSON data (the whole game state is JSON). */
export function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface TurnOutcome {
  state: GameState;
  report: TurnReport;
}

/** Players that may act this turn (they have placed their headquarters). */
export function activePlayers(state: GameState): PlayerId[] {
  return state.players
    .filter((p) => p.hq !== null)
    .map((p) => p.id)
    .sort();
}

/** Empty finance record at the start of a turn. */
export function newFinance(money: number): Finance {
  return { start: money, construction: 0, vehicles: 0, revenue: 0, tolls: 0, dividends: 0, upkeep: 0, interest: 0, end: 0 };
}

/**
 * Pure function: returns the next state and a report. `orders` maps player id to their action slots.
 * Slot 1 of every player is executed first (simultaneously), then slot 2, and so on.
 * Auctions whose highest bid stood a full turn close before the slots; new ones open at the end.
 */
export function resolveTurn(map: MapData, previous: GameState, orders: Record<PlayerId, OrderSlots>, now: number): TurnOutcome {
  const state = cloneState(previous);
  const world = new World(map, state);
  const rng = new Rng(hashSeed(state.settings.seed, 'turn', state.turn));
  const report: TurnReport = {
    turn: state.turn,
    resolvedAt: now,
    slots: [],
    finances: {},
    deliveries: [],
    auctions: [],
    market: [],
    replay: { ticks: TICKS_PER_TURN, vehicles: [], events: [] },
  };
  const fin: Record<PlayerId, Finance> = {};
  for (const p of state.players) fin[p.id] = newFinance(p.money);

  closeAuctions(state, report);
  const active = activePlayers(state);
  const slots = state.settings.actionSlots ?? DEFAULT_ACTION_SLOTS;
  for (let slot = 1; slot <= slots; slot++) {
    const entries: SlotEntry[] = [];
    for (const player of active) {
      const action = orders[player]?.[slot - 1];
      if (action) entries.push({ player, action });
    }
    for (const r of executeSlot(world, slot, entries)) {
      if (r.action.type === 'vehicles' || r.action.type === 'sell') fin[r.player].vehicles += r.cost;
      else fin[r.player].construction += r.cost;
      report.slots.push(r);
    }
  }

  const supply = simulateTurn(world, report, fin);
  chargeUpkeep(world, fin);
  chargeInterest(state, fin);
  updateMarket(state.market, marketDemand(map, state.industries), supply, rng, report);
  openAuctions(state, rng, report);

  for (const p of state.players) {
    fin[p.id].end = p.money;
    p.last = fin[p.id];
  }
  report.finances = fin;
  state.turn += 1;
  state.lastResolvedAt = now;
  return { state, report };
}

export interface OrdersPreview {
  /** The world as it would look after this player's actions if nobody else interferes. */
  world: World;
  results: (SlotResult | null)[];
}

/** Runs one player's slots on a copy of the state, without other players and without simulation. */
export function previewOrders(map: MapData, state: GameState, player: PlayerId, slots: OrderSlots): OrdersPreview {
  const copy = cloneState(state);
  const world = new World(map, copy);
  const results = slots.map((action, i) => (action ? executeSlot(world, i + 1, [{ player, action }])[0] : null));
  return { world, results };
}
