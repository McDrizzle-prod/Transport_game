import { describe, expect, it } from 'vitest';
import {
  AUCTIONS,
  LOANS,
  World,
  acceptAlliance,
  auctionStartPrice,
  bookValue,
  creditLimit,
  inviteToAlliance,
  migrateState,
  nextMinBid,
  placeBid,
  repayLoan,
  resolveTurn,
  takeLoan,
} from '../src';
import type { GameState, OrderSlots } from '../src';
import { addIndustry, hPath, makeWorld, slots } from './helpers';
import type { TestWorld } from './helpers';

function run(w: TestWorld, state: GameState, orders: Record<string, OrderSlots> = {}) {
  return resolveTurn(w.map, state, orders, 0);
}

const money = (s: GameState, id: string) => s.players.find((p) => p.id === id)!.money;

describe('loans', () => {
  it('are taken and repaid in steps up to a credit limit, and cost interest every turn', () => {
    const w = makeWorld({ width: 20, height: 12 });
    const world = new World(w.map, w.state);
    const start = money(w.state, 'A');
    expect(creditLimit(world, 'A')).toBe(LOANS.base);
    expect(takeLoan(world, 'A', 100_000)?.code).toBe('loan_amount');
    expect(takeLoan(world, 'A', 250_000)).toBeNull();
    expect(takeLoan(world, 'A', 500_000)?.code).toBe('loan_limit');
    expect(money(w.state, 'A')).toBe(start + 250_000);
    expect(w.state.players[0].debt).toBe(250_000);
    expect(repayLoan(world, 'A', 500_000)?.code).toBe('repay_too_much');

    const { state, report } = run(w, w.state);
    expect(report.finances.A.interest).toBe(250_000 * LOANS.rate);
    expect(money(state, 'A')).toBe(start + 250_000 - 250_000 * LOANS.rate);

    expect(repayLoan(new World(w.map, state), 'A', 250_000)).toBeNull();
    expect(state.players[0].debt).toBe(0);
  });

  it('allow more debt when the company owns more', () => {
    const w = makeWorld({ width: 30, height: 12, money: 3_000_000 });
    const path = hPath(w, 3, 13, 5);
    const { state } = run(w, w.state, {
      A: slots(
        { type: 'build', kind: 'rail', path, stationStart: true, stationEnd: true },
        { type: 'vehicles', model: 'train_diesel', from: path[0], to: path[path.length - 1], count: 5 },
      ),
    });
    // Bought for 10 × 6.000 + 2 × 90.000 + 5 × 380.000 = 2.140.000: book value 1.070.000.
    const world = new World(w.map, state);
    expect(bookValue(world, 'A')).toBe(1_070_000);
    // 500.000 + 50% of the book value, rounded down to whole steps.
    expect(creditLimit(world, 'A')).toBe(1_000_000);
  });
});

/** Four industries and turn 10: auctions start at the end of this turn. */
function auctionWorld() {
  const w = makeWorld({ width: 40, height: 12, players: ['A', 'B', 'C'] });
  addIndustry(w, 'farm', 2, 4, 60, 60);
  addIndustry(w, 'food_plant', 24, 4);
  addIndustry(w, 'forest', 30, 1, 60);
  addIndustry(w, 'coal_mine', 34, 6, 60);
  w.state.turn = AUCTIONS.startAfterTurn;
  return w;
}

describe('share auctions', () => {
  it('start after turn 10 with a few industries every turn', () => {
    const w = auctionWorld();
    const early = run(w, { ...w.state, turn: AUCTIONS.startAfterTurn - 1 });
    expect(early.state.auctions).toHaveLength(0);

    const { state, report } = run(w, w.state);
    expect(state.auctions).toHaveLength(AUCTIONS.perTurn);
    expect(report.auctions.filter((a) => a.status === 'opened')).toHaveLength(AUCTIONS.perTurn);
    const auction = state.auctions[0];
    expect(auction.openedTurn).toBe(AUCTIONS.startAfterTurn + 1);
    const ind = state.industries.find((i) => i.id === auction.industry)!;
    expect(auction.minBid).toBe(auctionStartPrice(ind));
    // The next turn: one more industry (the fourth); the others already have an open auction.
    expect(run(w, state).state.auctions).toHaveLength(AUCTIONS.perTurn + 1);
  });

  it('reserve the money of the highest bid and give it back when somebody bids more', () => {
    const w = auctionWorld();
    const { state } = run(w, w.state);
    const auction = state.auctions[0];
    const a0 = money(state, 'A');
    const b0 = money(state, 'B');
    expect(placeBid(state, 'A', auction.id, auction.minBid - 1, 0)?.code).toBe('bid_too_low');
    expect(placeBid(state, 'A', auction.id, auction.minBid, 0)).toBeNull();
    expect(money(state, 'A')).toBe(a0 - auction.minBid);
    expect(placeBid(state, 'A', auction.id, auction.minBid * 2, 0)?.code).toBe('already_highest');
    // At least 5% more.
    expect(placeBid(state, 'B', auction.id, auction.minBid + 1, 0)?.code).toBe('bid_too_low');
    const raise = nextMinBid(auction);
    expect(raise).toBeGreaterThanOrEqual(auction.minBid * (1 + AUCTIONS.minIncrement));
    expect(placeBid(state, 'B', auction.id, raise, 0)).toBeNull();
    expect(money(state, 'A')).toBe(a0);
    expect(money(state, 'B')).toBe(b0 - raise);
    expect(placeBid(state, 'C', auction.id, 10 ** 9, 0)?.code).toBe('insufficient_funds');
  });

  it('close when the highest bid has stood for one full turn', () => {
    const w = auctionWorld();
    const opened = run(w, w.state).state; // turn 11 is being planned
    const id = opened.auctions[0].id;
    expect(placeBid(opened, 'A', id, opened.auctions[0].minBid, 0)).toBeNull();

    // End of turn 11: the bid was placed during this turn, so the others still get turn 12 to react.
    const t11 = run(w, opened);
    expect(t11.state.auctions.find((a) => a.id === id)!.status).toBe('open');

    // End of turn 12: nobody bid more, A gets the share.
    const t12 = run(w, t11.state);
    const auction = t12.state.auctions.find((a) => a.id === id)!;
    expect(auction.status).toBe('sold');
    const ind = t12.state.industries.find((i) => i.id === auction.industry)!;
    expect(ind.shares).toEqual({ A: 1 });
    expect(t12.report.auctions).toContainEqual({ auction: id, industry: ind.id, status: 'sold', winner: 'A', price: auction.minBid });
  });

  it('expire after three turns without bids', () => {
    const w = auctionWorld();
    let state = run(w, w.state).state;
    const id = state.auctions[0].id;
    state = run(w, state).state; // end of 11
    state = run(w, state).state; // end of 12
    expect(state.auctions.find((a) => a.id === id)!.status).toBe('open');
    const t13 = run(w, state);
    expect(t13.state.auctions.find((a) => a.id === id)!.status).toBe('expired');
  });
});

describe('industry shares', () => {
  /** A transports grain from the farm to the food plant; the farm's shares are set by the test. */
  function grainLine(shares: Record<string, number>) {
    const w = makeWorld({ width: 32, height: 12, players: ['A', 'B'] });
    const farm = addIndustry(w, 'farm', 2, 4, 60, 60);
    addIndustry(w, 'food_plant', 24, 4);
    farm.shares = shares;
    const path = hPath(w, 4, 23, 5);
    const orders = {
      A: slots(
        { type: 'build', kind: 'road', path, stationStart: true, stationEnd: true },
        { type: 'vehicles', model: 'truck', from: path[0], to: path[path.length - 1], count: 2 },
      ),
    };
    return { w, orders };
  }

  it('earn shareholders a part of what others earn with cargo from the industry', () => {
    const { w, orders } = grainLine({ B: 2 });
    const { report } = run(w, w.state, orders);
    const grain = report.deliveries.find((d) => d.cargo === 'grain')!;
    expect(grain.toll).toBe(Math.round(grain.revenue * 2 * AUCTIONS.tollPerShare));
    expect(report.finances.A.tolls).toBe(grain.toll);
    expect(report.finances.B.dividends).toBe(grain.toll);
    // Own deliveries are toll-free.
    const own = grainLine({ A: 2 });
    expect(run(own.w, own.w.state, own.orders).report.finances.A.tolls).toBe(0);
  });

  it('with a majority let the owner decide who loads there: only the owner and allies', () => {
    const { w, orders } = grainLine({ B: AUCTIONS.majority });
    const excluded = run(w, w.state, orders);
    expect(excluded.report.deliveries.filter((d) => d.cargo === 'grain')).toHaveLength(0);

    const allied = structuredClone(w.state);
    inviteToAlliance(allied, 'A', 'B', 0);
    acceptAlliance(allied, 'B', 'A');
    const together = run(w, allied, orders);
    expect(together.report.deliveries.filter((d) => d.cargo === 'grain').length).toBe(1);
  });
});

describe('saved games of older versions', () => {
  it('get the new fields', () => {
    const w = makeWorld({ width: 20, height: 12 });
    const old = JSON.parse(JSON.stringify(w.state)) as Record<string, unknown> & GameState;
    delete (old as Partial<GameState>).auctions;
    delete (old as Partial<GameState>).cityStock;
    delete (old.settings as Partial<GameState['settings']>).actionSlots;
    delete (old.players[0] as Partial<GameState['players'][0]>).debt;
    const migrated = migrateState(old);
    expect(migrated.auctions).toEqual([]);
    expect(migrated.cityStock).toEqual({});
    expect(migrated.settings.actionSlots).toBe(5);
    expect(migrated.players[0].debt).toBe(0);
  });
});
