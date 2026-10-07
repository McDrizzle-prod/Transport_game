// Company value, loans and interest. Taking and repaying loans are free actions (no slot).
import { LOANS, STATIONS, VEHICLES } from './config';
import { edgeCost } from './construction';
import type { Finance, GameState, Msg, PlayerId } from './types';
import type { World } from './world';

/** Book value of vehicles, stations and infrastructure (shared things count for their part). */
export function bookValue(world: World, player: PlayerId): number {
  let total = 0;
  for (const v of world.state.vehicles) if (v.owner === player) total += VEHICLES[v.model].price;
  for (const s of world.state.stations) if (s.owners.includes(player)) total += STATIONS[s.kind].cost / s.owners.length;
  for (const e of Object.values(world.state.infra.edges)) {
    if (e.owners.includes(player)) total += edgeCost(world, e.kind, e.a, e.b) / e.owners.length;
  }
  return Math.round(total * LOANS.bookValue);
}

/** Maximum total debt: a fixed amount plus part of the book value, rounded down to whole loan steps. */
export function creditLimit(world: World, player: PlayerId): number {
  const limit = LOANS.base + LOANS.bookFactor * bookValue(world, player);
  return Math.floor(limit / LOANS.step) * LOANS.step;
}

export interface CompanyValue {
  money: number;
  book: number;
  debt: number;
  /** money + book value − debt */
  value: number;
  creditLimit: number;
}

export function companyValue(world: World, player: PlayerId): CompanyValue {
  const p = world.player(player);
  const book = bookValue(world, player);
  return { money: p.money, book, debt: p.debt, value: p.money + book - p.debt, creditLimit: creditLimit(world, player) };
}

function checkAmount(amount: number): Msg | null {
  if (!Number.isInteger(amount) || amount <= 0 || amount % LOANS.step !== 0) return { code: 'loan_amount', step: LOANS.step };
  return null;
}

export function takeLoan(world: World, player: PlayerId, amount: number): Msg | null {
  if (world.state.phase !== 'running') return { code: 'not_running' };
  const bad = checkAmount(amount);
  if (bad) return bad;
  const p = world.player(player);
  const limit = creditLimit(world, player);
  if (p.debt + amount > limit) return { code: 'loan_limit', limit, debt: p.debt };
  p.debt += amount;
  p.money += amount;
  return null;
}

export function repayLoan(world: World, player: PlayerId, amount: number): Msg | null {
  if (world.state.phase !== 'running') return { code: 'not_running' };
  const bad = checkAmount(amount);
  if (bad) return bad;
  const p = world.player(player);
  if (amount > p.debt) return { code: 'repay_too_much', debt: p.debt };
  if (amount > p.money) return { code: 'insufficient_funds', cost: amount, money: p.money };
  p.debt -= amount;
  p.money -= amount;
  return null;
}

/** Interest on outstanding loans, charged at the end of every turn. */
export function chargeInterest(state: GameState, fin: Record<PlayerId, Finance>): void {
  for (const p of state.players) {
    const interest = Math.round((p.debt ?? 0) * LOANS.rate);
    if (interest <= 0) continue;
    p.money -= interest;
    if (fin[p.id]) fin[p.id].interest += interest;
  }
}
