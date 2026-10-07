// Simple market: prices react to how much of each cargo is delivered compared to map-wide demand.
import { CARGO_IDS, INDUSTRIES, MARKET, MARKET_CARGO, MARKET_HISTORY_LENGTH } from './config';
import type { Rng } from './rng';
import type { CargoAmounts, CargoId, Industry, MapData, MarketState, TurnReport } from './types';

/** Units per turn wanted on the whole map: city demand plus processing capacity of industries. */
export function marketDemand(map: MapData, industries: Industry[]): CargoAmounts {
  const demand: CargoAmounts = {};
  for (const city of map.cities) {
    for (const [cargo, amount] of Object.entries(city.demand) as [CargoId, number][]) {
      demand[cargo] = (demand[cargo] ?? 0) + amount;
    }
  }
  for (const ind of industries) {
    const inputs = INDUSTRIES[ind.type].inputs;
    if (!inputs) continue;
    for (const [cargo, ratio] of Object.entries(inputs) as [CargoId, number][]) {
      demand[cargo] = (demand[cargo] ?? 0) + ind.rate * ratio;
    }
  }
  return demand;
}

export function initialMarket(map: MapData, industries: Industry[]): MarketState {
  const prices = {} as Record<CargoId, number>;
  const history = {} as Record<CargoId, number[]>;
  for (const c of CARGO_IDS) {
    prices[c] = 1;
    history[c] = [1];
  }
  return { prices, history, supply: {}, demand: marketDemand(map, industries) };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Moves every price a step towards its target. The target is high when little is delivered
 * (scarcity) and drops the more of the map-wide demand is being supplied.
 */
export function updateMarket(market: MarketState, demand: CargoAmounts, supply: CargoAmounts, rng: Rng, report: TurnReport): void {
  for (const cargo of MARKET_CARGO) {
    const before = market.prices[cargo] ?? 1;
    const d = demand[cargo] ?? 0;
    const s = supply[cargo] ?? 0;
    let after = before;
    if (d > 0) {
      const target = clamp(MARKET.scarce - MARKET.slope * (s / d), MARKET.min, MARKET.max);
      after = before + MARKET.reaction * (target - before) + rng.range(-MARKET.noise, MARKET.noise);
      after = Math.round(clamp(after, MARKET.min, MARKET.max) * 1000) / 1000;
    }
    market.prices[cargo] = after;
    const history = market.history[cargo] ?? (market.history[cargo] = []);
    history.push(after);
    if (history.length > MARKET_HISTORY_LENGTH) history.splice(0, history.length - MARKET_HISTORY_LENGTH);
    report.market.push({ cargo, before, after, supplied: s, demand: d });
  }
  market.supply = supply;
  market.demand = demand;
}
