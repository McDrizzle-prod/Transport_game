// The exchange: loans and auctions of industry shares. Both are free actions (they don't use a slot).
import { useState } from 'react';
import { AUCTIONS, CARGO, INDUSTRIES, LOANS, companyValue, highestBid, majorityHolder, nextMinBid } from '@transport/shared';
import type { Auction, Industry } from '@transport/shared';
import { money, num } from '../format';
import { useStore, useUi } from '../state/store';

export function ExchangeTab() {
  const view = useUi((s) => s.view)!;
  const me = view.game.players.find((p) => p.id === view.you?.playerId);
  return (
    <section className="panel-section exchange">
      <h3>Beurs</h3>
      <p className="hint">Lenen, aflossen en bieden kosten géén actie: ze gaan meteen in.</p>
      {me && view.game.phase === 'running' && <Loans />}
      <Auctions />
      <Holdings />
    </section>
  );
}

function Loans() {
  const store = useStore();
  useUi((s) => s.view);
  const world = store.world();
  const me = store.me();
  if (!world || !me) return null;
  const v = companyValue(world, me.id);
  const room = Math.max(0, v.creditLimit - v.debt);
  return (
    <div className="info-block">
      <h4>🏦 Je bedrijf</h4>
      <dl className="stats">
        <dt>Geld</dt>
        <dd>{money(v.money)}</dd>
        <dt>Bezit (boekwaarde)</dt>
        <dd>{money(v.book)}</dd>
        <dt>Schuld</dt>
        <dd className={v.debt > 0 ? 'neg' : ''}>{v.debt > 0 ? `−${money(v.debt)}` : money(0)}</dd>
        <dt>Bedrijfswaarde</dt>
        <dd>
          <strong>{money(v.value)}</strong>
        </dd>
        <dt>Kredietlimiet</dt>
        <dd>
          {money(v.creditLimit)} <span className="muted small">(nog {money(room)})</span>
        </dd>
        {v.debt > 0 && (
          <>
            <dt>Rente</dt>
            <dd className="neg">−{money(v.debt * LOANS.rate)} per beurt</dd>
          </>
        )}
      </dl>
      <div className="button-row">
        <button className="secondary" disabled={room < LOANS.step} onClick={() => void store.loan('take', LOANS.step)}>
          Leen {money(LOANS.step)}
        </button>
        <button className="secondary" disabled={v.debt < LOANS.step || me.money < LOANS.step} onClick={() => void store.loan('repay', LOANS.step)}>
          Los {money(LOANS.step)} af
        </button>
      </div>
      <p className="muted small">
        Rente {Math.round(LOANS.rate * 100)}% per beurt over je schuld. Limiet: {money(LOANS.base)} plus {Math.round(LOANS.bookFactor * 100)}% van de
        boekwaarde ({Math.round(LOANS.bookValue * 100)}% van wat je voertuigen, stations en infrastructuur kostten).
      </p>
    </div>
  );
}

function Auctions() {
  const view = useUi((s) => s.view)!;
  const game = view.game;
  const open = game.auctions.filter((a) => a.status === 'open');
  const closed = game.auctions.filter((a) => a.status !== 'open').sort((a, b) => (b.closedTurn ?? 0) - (a.closedTurn ?? 0));
  return (
    <div className="info-block">
      <h4>🔨 Veilingen van aandelen</h4>
      <p className="small">
        Na beurt {AUCTIONS.startAfterTurn} komt er elke beurt van {AUCTIONS.perTurn} industrieën een aandeel van 10% in de veiling. Een aandeel geeft
        je {Math.round(AUCTIONS.tollPerShare * 100)}% van wat <em>anderen</em> verdienen met vracht van die industrie. Met {AUCTIONS.majority} of
        meer aandelen bepaal je wie er mag laden: alleen jij en je bondgenoten.
      </p>
      <p className="muted small">
        Je bod wordt meteen gereserveerd en komt terug als iemand hoger biedt (minstens {Math.round(AUCTIONS.minIncrement * 100)}% meer). Blijft
        een bod een hele beurt het hoogste staan, dan is de veiling gesloten.
      </p>
      {game.phase === 'running' && game.turn <= AUCTIONS.startAfterTurn && open.length === 0 && (
        <p className="muted">De eerste veilingen openen na beurt {AUCTIONS.startAfterTurn} (nu beurt {game.turn}).</p>
      )}
      {game.turn > AUCTIONS.startAfterTurn && open.length === 0 && <p className="muted">Er zijn nu geen open veilingen.</p>}
      <ul className="auctions">
        {open.map((a) => (
          <AuctionRow key={a.id} auction={a} />
        ))}
      </ul>
      {closed.length > 0 && (
        <>
          <h4>Afgelopen</h4>
          <ul className="plain small">
            {closed.map((a) => (
              <ClosedAuction key={a.id} auction={a} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function industryLabel(ind: Industry | undefined): string {
  if (!ind) return 'Onbekende industrie';
  return `${INDUSTRIES[ind.type].icon} ${ind.name}`;
}

function AuctionRow({ auction }: { auction: Auction }) {
  const store = useStore();
  const view = useUi((s) => s.view)!;
  const game = view.game;
  const me = view.you?.playerId;
  const ind = game.industries.find((i) => i.id === auction.industry);
  const top = highestBid(auction);
  const min = nextMinBid(auction);
  const [amount, setAmount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const value = amount ?? min;
  const mine = top?.player === me;
  const owned = ind ? Object.entries(ind.shares).filter(([, n]) => n > 0) : [];
  let status: string;
  if (top) {
    const closes = top.turn + 1;
    status = `Hoogste bod ${money(top.amount)} van ${mine ? 'jou' : store.playerName(top.player)} · gaat naar ${mine ? 'jou' : 'deze bieder'} aan het eind van beurt ${closes} als niemand meer biedt`;
  } else {
    status = `Nog geen bod · vervalt na beurt ${auction.openedTurn + AUCTIONS.expireTurns - 1}`;
  }
  const bid = async () => {
    setBusy(true);
    if (await store.bid(auction.id, Math.round(value))) setAmount(null);
    setBusy(false);
  };
  return (
    <li className={`auction ${mine ? 'mine' : ''}`}>
      <div className="auction-head">
        <button className="link" onClick={() => ind && store.focusTile(ind.y * store.getState().map!.width + ind.x)}>
          {industryLabel(ind)}
        </button>
        {ind && (
          <span className="muted small">
            {CARGO[INDUSTRIES[ind.type].output].icon} {num(ind.rate)}/beurt
            {owned.length > 0 && ` · aandeelhouders: ${owned.map(([p, n]) => `${store.playerName(p)} ${n}`).join(', ')}`}
          </span>
        )}
      </div>
      <p className="small">{status}</p>
      {me && game.phase === 'running' && !mine && (
        <div className="copy-row">
          <input
            type="number"
            min={min}
            step={1000}
            value={value}
            onChange={(e) => setAmount(Number(e.target.value))}
            aria-label={`Bod op ${ind?.name ?? 'industrie'}`}
          />
          <button className="primary" disabled={busy || value < min} onClick={() => void bid()}>
            Bied
          </button>
        </div>
      )}
      {!mine && <span className="muted small">Minimaal {money(min)}</span>}
    </li>
  );
}

function ClosedAuction({ auction }: { auction: Auction }) {
  const store = useStore();
  const game = useUi((s) => s.view!.game);
  const ind = game.industries.find((i) => i.id === auction.industry);
  const top = highestBid(auction);
  return (
    <li>
      {industryLabel(ind)}:{' '}
      {auction.status === 'sold' && top
        ? `verkocht aan ${store.playerName(top.player)} voor ${money(top.amount)} (beurt ${auction.closedTurn})`
        : `geen bieders, aandeel blijft bij de bank (beurt ${auction.closedTurn})`}
    </li>
  );
}

function Holdings() {
  const store = useStore();
  const game = useUi((s) => s.view!.game);
  const me = useUi((s) => s.view!.you?.playerId);
  const held = game.industries.filter((i) => Object.values(i.shares).some((n) => n > 0));
  if (held.length === 0) return null;
  return (
    <div className="info-block">
      <h4>📜 Aandeelhouders</h4>
      <ul className="plain small">
        {held.map((ind) => {
          const holder = majorityHolder(ind);
          return (
            <li key={ind.id}>
              <button className="link small" onClick={() => store.focusTile(ind.y * store.getState().map!.width + ind.x)}>
                {industryLabel(ind)}
              </button>
              :{' '}
              {Object.entries(ind.shares)
                .filter(([, n]) => n > 0)
                .map(([p, n]) => `${p === me ? 'jij' : store.playerName(p)} ${n}/${AUCTIONS.sharesPerIndustry}`)
                .join(', ')}
              {holder && ` · alleen ${holder === me ? 'jij en je bondgenoten mogen' : `${store.playerName(holder)} en bondgenoten mogen`} hier laden`}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
