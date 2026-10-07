// Shares of industries and the auctions in which they are sold.
//
// After AUCTIONS.startAfterTurn turns, a few industries put one share (10%) up for auction every turn.
// Bidding is a free action (no slot). The money of the highest bid is reserved straight away and
// returned when somebody bids more. An auction closes when its highest bid has stood for one full
// turn: a bid placed during turn T wins at the execution of turn T + 1 if nobody outbids it.
import { AUCTIONS, CARGO, INDUSTRIES } from './config';
import type { Rng } from './rng';
import type { Auction, Bid, GameState, Industry, Msg, PlayerId, TurnReport } from './types';

export function playerShares(ind: Industry): number {
  return Object.values(ind.shares ?? {}).reduce((s, n) => s + n, 0);
}

/** Shares still owned by the bank. */
export function bankShares(ind: Industry): number {
  return AUCTIONS.sharesPerIndustry - playerShares(ind);
}

/** The player who decides who may pick up cargo at the industry (owns a majority of the shares). */
export function majorityHolder(ind: Industry): PlayerId | null {
  for (const [player, n] of Object.entries(ind.shares ?? {})) if (n >= AUCTIONS.majority) return player;
  return null;
}

/** Tolls a player pays on revenue from cargo of this industry: one entry per other shareholder. */
export function tollsFor(ind: Industry, player: PlayerId): { holder: PlayerId; part: number }[] {
  const result: { holder: PlayerId; part: number }[] = [];
  for (const [holder, n] of Object.entries(ind.shares ?? {})) {
    if (holder !== player && n > 0) result.push({ holder, part: n * AUCTIONS.tollPerShare });
  }
  return result;
}

export function highestBid(auction: Auction): Bid | undefined {
  return auction.bids[auction.bids.length - 1];
}

const roundUp = (n: number, step: number) => Math.ceil(n / step) * step;

/** The lowest amount a new bid needs. */
export function nextMinBid(auction: Auction): number {
  const top = highestBid(auction);
  return top ? roundUp(top.amount * (1 + AUCTIONS.minIncrement), 1_000) : auction.minBid;
}

/** Starting price of a share: a few turns of the industry's production value. */
export function auctionStartPrice(ind: Industry): number {
  const cargo = INDUSTRIES[ind.type].output;
  return roundUp(ind.rate * CARGO[cargo].price * AUCTIONS.minBidFactor, 5_000);
}

export function placeBid(state: GameState, playerId: PlayerId, auctionId: number, amount: number, now: number): Msg | null {
  if (state.phase !== 'running') return { code: 'not_running' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.hq === null) return { code: 'unknown_player' };
  const auction = state.auctions.find((a) => a.id === auctionId);
  if (!auction || auction.status !== 'open') return { code: 'auction_closed' };
  if (!Number.isInteger(amount) || amount <= 0) return { code: 'bid_invalid' };
  const top = highestBid(auction);
  if (top?.player === playerId) return { code: 'already_highest' };
  const min = nextMinBid(auction);
  if (amount < min) return { code: 'bid_too_low', min };
  if (amount > player.money) return { code: 'insufficient_funds', cost: amount, money: player.money };
  if (top) {
    const previous = state.players.find((p) => p.id === top.player);
    if (previous) previous.money += top.amount;
  }
  player.money -= amount;
  auction.bids.push({ player: playerId, amount, turn: state.turn, at: now });
  return null;
}

/** Start of a turn's execution: sells shares whose highest bid stood a full turn and ends auctions nobody wanted. */
export function closeAuctions(state: GameState, report: TurnReport): void {
  for (const auction of state.auctions) {
    if (auction.status !== 'open') continue;
    const top = highestBid(auction);
    const industry = state.industries.find((i) => i.id === auction.industry);
    if (top && top.turn <= state.turn - 1) {
      auction.status = 'sold';
      auction.closedTurn = state.turn;
      // The money was reserved when the bid was placed; it goes to the bank.
      if (industry) industry.shares[top.player] = (industry.shares[top.player] ?? 0) + 1;
      report.auctions.push({ auction: auction.id, industry: auction.industry, status: 'sold', winner: top.player, price: top.amount });
    } else if (!top && state.turn >= auction.openedTurn + AUCTIONS.expireTurns - 1) {
      auction.status = 'expired';
      auction.closedTurn = state.turn;
      report.auctions.push({ auction: auction.id, industry: auction.industry, status: 'expired' });
    }
  }
  // Keep finished auctions for a few turns so players can see what happened.
  state.auctions = state.auctions.filter((a) => a.status === 'open' || (a.closedTurn ?? 0) > state.turn - 5);
}

/** End of a turn's execution: puts shares of a few random industries up for auction for the next turn. */
export function openAuctions(state: GameState, rng: Rng, report: TurnReport): void {
  if (state.turn < AUCTIONS.startAfterTurn) return;
  const busy = new Set(state.auctions.filter((a) => a.status === 'open').map((a) => a.industry));
  const candidates = state.industries.filter((ind) => bankShares(ind) > 0 && !busy.has(ind.id));
  for (const ind of rng.shuffle(candidates).slice(0, AUCTIONS.perTurn)) {
    const auction: Auction = {
      id: state.nextId++,
      industry: ind.id,
      openedTurn: state.turn + 1,
      minBid: auctionStartPrice(ind),
      bids: [],
      status: 'open',
    };
    state.auctions.push(auction);
    report.auctions.push({ auction: auction.id, industry: ind.id, status: 'opened' });
  }
}
