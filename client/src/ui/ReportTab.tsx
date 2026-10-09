// Result of the last executed turn: per slot what happened (incl. conflicts), finances, deliveries.
import { CARGO, INDUSTRIES } from '@transport/shared';
import type { SlotResult, TurnReport } from '@transport/shared';
import { money, num, signedMoney, tileLabel, when } from '../format';
import { OUTCOME_TEXT, actionTitle, msgText } from '../i18n';
import { useStore, useUi } from '../state/store';

export function ReportTab() {
  const store = useStore();
  const report = useUi((s) => s.report);
  const replay = useUi((s) => s.replay);
  const view = useUi((s) => s.view)!;
  if (!report) {
    return (
      <section className="panel-section">
        <h3>Rapport</h3>
        <p className="muted">Nog geen beurt uitgevoerd. Na de uitvoering zie je hier wat er per actieslot is gebeurd.</p>
      </section>
    );
  }
  const me = view.you?.playerId;
  const fin = me ? report.finances[me] : undefined;
  return (
    <section className="panel-section report">
      <div className="section-head">
        <h3>Beurt {report.turn}</h3>
        <span className="muted small">{when(report.resolvedAt)}</span>
      </div>
      <button className="primary wide" onClick={() => (replay ? store.stopReplay() : store.playReplay())}>
        {replay ? '⏹ Stop afspelen' : '▶ Speel de beurt af op de kaart'}
      </button>
      {fin && (
        <dl className="stats finance">
          <dt>Begin</dt>
          <dd>{money(fin.start)}</dd>
          <dt>Bouwen</dt>
          <dd className="neg">−{money(fin.construction)}</dd>
          <dt>Voertuigen</dt>
          <dd className="neg">−{money(fin.vehicles)}</dd>
          <dt>Opbrengst ritten</dt>
          <dd className="pos">+{money(fin.revenue)}</dd>
          {(fin.tolls ?? 0) > 0 && (
            <>
              <dt>Aan aandeelhouders</dt>
              <dd className="neg">−{money(fin.tolls)}</dd>
            </>
          )}
          {(fin.dividends ?? 0) > 0 && (
            <>
              <dt>Van je aandelen</dt>
              <dd className="pos">+{money(fin.dividends)}</dd>
            </>
          )}
          <dt>Onderhoud</dt>
          <dd className="neg">−{money(fin.upkeep)}</dd>
          {(fin.interest ?? 0) > 0 && (
            <>
              <dt>Rente</dt>
              <dd className="neg">−{money(fin.interest)}</dd>
            </>
          )}
          <dt>Eind</dt>
          <dd>
            <strong>{money(fin.end)}</strong> <span className={fin.end - fin.start >= 0 ? 'pos' : 'neg'}>({signedMoney(fin.end - fin.start)})</span>
          </dd>
        </dl>
      )}
      <SlotResults report={report} />
      <Deliveries report={report} />
      <AuctionResults report={report} />
    </section>
  );
}

function AuctionResults({ report }: { report: TurnReport }) {
  const store = useStore();
  const game = useUi((s) => s.view!.game);
  const results = report.auctions ?? [];
  if (results.length === 0) return null;
  const name = (id: number) => {
    const ind = game.industries.find((i) => i.id === id);
    return ind ? `${INDUSTRIES[ind.type].icon} ${ind.name}` : `Industrie ${id}`;
  };
  return (
    <>
      <h4>Beurs</h4>
      <ul className="plain small">
        {results.map((r) => (
          <li key={`${r.auction}${r.status}`}>
            {r.status === 'opened' && `🔨 Nieuw in de veiling: 10% van ${name(r.industry)}`}
            {r.status === 'sold' && `✅ 10% van ${name(r.industry)} verkocht aan ${store.playerName(r.winner!)} voor ${money(r.price ?? 0)}`}
            {r.status === 'expired' && `⌛ Geen bieders voor ${name(r.industry)}`}
          </li>
        ))}
      </ul>
      {results.some((r) => r.status === 'opened') && (
        <button className="link small" onClick={() => store.setTab('exchange')}>
          Naar de beurs →
        </button>
      )}
    </>
  );
}

function SlotResults({ report }: { report: TurnReport }) {
  const store = useStore();
  const view = useUi((s) => s.view)!;
  const width = useUi((s) => s.map!.width);
  const me = view.you?.playerId;
  const colors = new Map(view.game.players.map((p) => [p.id, p.color]));
  const count = report.slots.reduce((max, r) => Math.max(max, r.slot), 0);
  const slots = Array.from({ length: count }, (_, i) =>
    report.slots.filter((r) => r.slot === i + 1).sort((a, b) => (a.player === me ? -1 : b.player === me ? 1 : 0)),
  );
  return (
    <>
      <h4>Uitvoering per actieslot</h4>
      {count === 0 && <p className="muted small">Niemand had acties gepland.</p>}
      <ol className="report-slots">
        {slots.map((results, i) => (
          <li key={i}>
            <span className="slot-num">{i + 1}</span>
            <div>
              {results.length === 0 && <span className="muted small">Geen acties</span>}
              {results.map((r, k) => (
                <ResultLine key={k} r={r} color={colors.get(r.player) ?? '#999'} mine={r.player === me} width={width} name={store.playerName} />
              ))}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function ResultLine({ r, color, mine, width, name }: { r: SlotResult; color: string; mine: boolean; width: number; name: (id: string) => string }) {
  const store = useStore();
  return (
    <div className={`result ${r.outcome} ${mine ? 'mine' : ''}`}>
      <div className="result-head">
        <i className="dot-color" style={{ background: color }} />
        <strong>{name(r.player)}</strong>
        <span className="result-title">{actionTitle(r.action, width)}</span>
        <span className={`badge ${r.outcome}`}>{OUTCOME_TEXT[r.outcome]}</span>
      </div>
      {r.cost > 0 && <span className="small muted">{money(r.cost)}</span>}
      {groupBy(r.lost, (l) => `${l.owners.join(',')}|${l.turn}|${l.slot}`).map((g) => (
        <button key={`l${g[0].tile}`} className="link small conflict" onClick={() => store.focusTile(g[0].tile, true)}>
          ✖ {tiles(g.length)} {tileLabel(g[0].tile, width)}
          {g.length > 1 ? ' e.a.' : ''} {g[0].owners.length ? `al van ${g[0].owners.map(name).join(' & ')}` : 'geweigerd'}
          {g[0].turn ? ` (beurt ${g[0].turn}, slot ${g[0].slot})` : ''}
        </button>
      ))}
      {groupBy(r.shared, (sh) => sh.with.join(',')).map((g) => (
        <button key={`s${g[0].tile}`} className="link small shared" onClick={() => store.focusTile(g[0].tile, true)}>
          ⇄ {tiles(g.length)} {tileLabel(g[0].tile, width)}
          {g.length > 1 ? ' e.a.' : ''} gedeeld met {g[0].with.map(name).join(' & ')} (zelfde slot)
        </button>
      ))}
      {r.messages.map((m, k) => (
        <span key={k} className="small msg">
          {msgText(m, name)}
        </span>
      ))}
    </div>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return [...groups.values()];
}

const tiles = (n: number) => (n === 1 ? 'Tegel' : `${n} tegels vanaf`);

function Deliveries({ report }: { report: TurnReport }) {
  const store = useStore();
  const view = useUi((s) => s.view)!;
  const me = view.you?.playerId;
  const mine = report.deliveries.filter((d) => d.player === me);
  const lineName = (id: number) => view.game.lines.find((l) => l.id === id)?.name ?? `Lijn ${id}`;
  const totals = new Map<string, number>();
  for (const d of report.deliveries) totals.set(d.player, (totals.get(d.player) ?? 0) + d.revenue);
  const bonus = mine.reduce((s, d) => s + (d.bonus ?? 0), 0);
  const tolls = mine.reduce((s, d) => s + (d.toll ?? 0), 0);
  const transfers = mine.some((d) => (d.transferred ?? 0) > 0);
  return (
    <>
      <h4>Leveringen</h4>
      {mine.length === 0 ? (
        <p className="muted small">Jouw voertuigen hebben deze beurt niets afgeleverd.</p>
      ) : (
        <table className="flows">
          <thead>
            <tr>
              <th>Lijn</th>
              <th>Vracht</th>
              <th>Ritten</th>
              <th>Opbrengst</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((d, i) => (
              <tr key={i}>
                <td className="small">{lineName(d.lineId)}</td>
                <td>
                  {d.amount > 0 && `${CARGO[d.cargo].icon} ${num(d.amount)}`}
                  {(d.transferred ?? 0) > 0 && (
                    <span className="transfer" title="Overgeslagen naar een andere lijn">
                      {d.amount > 0 ? ' · ' : ''}
                      {CARGO[d.cargo].icon} {num(d.transferred ?? 0)} ⇄
                    </span>
                  )}
                </td>
                <td>{d.trips}</td>
                <td>
                  {money(d.revenue)}
                  {(d.bonus ?? 0) > 0 && <small className="pos"> 🏢</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {transfers && (
        <p className="small muted">
          ⇄ = overgeslagen naar een andere lijn. Die vracht levert geld op zodra ze bij de klant is; dan krijgt elke lijn een deel naar de
          afstand die ze aflegde.
        </p>
      )}
      {(bonus > 0 || tolls > 0) && (
        <p className="small">
          {bonus > 0 && <span className="pos">🏢 Hoofdkantoorbonus: {money(bonus)} (zit in de opbrengst). </span>}
          {tolls > 0 && <span className="neg">📜 Afgedragen aan aandeelhouders: {money(tolls)}.</span>}
        </p>
      )}
      {totals.size > 0 && (
        <p className="small muted">
          Totaal per bedrijf:{' '}
          {[...totals.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([p, v]) => `${store.playerName(p)} ${money(v)}`)
            .join(' · ')}
        </p>
      )}
    </>
  );
}
