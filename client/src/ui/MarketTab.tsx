// Market prices per cargo: current multiplier, change, trend and last turn's supply vs. demand.
import { useState } from 'react';
import { CARGO, MARKET_CARGO } from '@transport/shared';
import type { CargoId } from '@transport/shared';
import { money, num } from '../format';
import { useUi } from '../state/store';

export function MarketTab() {
  const market = useUi((s) => s.view!.game.market);
  return (
    <section className="panel-section market">
      <h3>Markt</h3>
      <p className="hint">
        Prijzen reageren op vraag en aanbod op de hele kaart: wordt een goed veel geleverd, dan daalt de prijs; is het schaars, dan stijgt hij.
        ×1,00 is de basisprijs. Passagiers hebben een vaste prijs ({money(CARGO.passengers.price)} per passagier per tegel).
      </p>
      <table className="market-table">
        <thead>
          <tr>
            <th>Goed</th>
            <th className="num">Prijs</th>
            <th>Verloop</th>
            <th className="num">Geleverd / vraag</th>
          </tr>
        </thead>
        <tbody>
          {MARKET_CARGO.map((c) => (
            <MarketRow
              key={c}
              cargo={c}
              price={market.prices[c] ?? 1}
              history={market.history[c] ?? []}
              supply={market.supply[c] ?? 0}
              demand={market.demand[c] ?? 0}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MarketRow({ cargo, price, history, supply, demand }: { cargo: CargoId; price: number; history: number[]; supply: number; demand: number }) {
  const def = CARGO[cargo];
  const prev = history.length > 1 ? history[history.length - 2] : price;
  const delta = price - prev;
  return (
    <tr>
      <td>
        <span className="cargo-cell">
          {def.icon} {def.name}
          <small>{money(def.price * price)}/ton/tegel</small>
        </span>
      </td>
      <td className="num">
        <strong>×{price.toFixed(2).replace('.', ',')}</strong>
        {Math.abs(delta) >= 0.005 && (
          <small className={delta > 0 ? 'pos' : 'neg'}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(2).replace('.', ',')}
          </small>
        )}
      </td>
      <td>
        <Sparkline values={history} label={def.name} />
      </td>
      <td className="num small">
        {num(supply)} / {num(demand)}
      </td>
    </tr>
  );
}

const W = 96;
const H = 30;
const PAD = 5;

/** Price trend with a base-price reference line and a hover read-out per turn. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (values.length < 2) return <span className="muted small">—</span>;
  const lo = Math.min(0.9, ...values);
  const hi = Math.max(1.1, ...values);
  const x = (i: number) => PAD + (i / (values.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  const shown = hover ?? last;
  const turnsAgo = last - shown;
  return (
    <span className="spark">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Prijsverloop ${label}: van ×${values[0].toFixed(2)} naar ×${values[last].toFixed(2)}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - PAD) / (W - 2 * PAD)) * last);
          setHover(Math.max(0, Math.min(last, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <line x1={PAD} x2={W - PAD} y1={y(1)} y2={y(1)} className="spark-base" />
        <polyline points={points} className="spark-line" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={2} y2={H - 2} className="spark-cross" />}
        <circle cx={x(shown)} cy={y(values[shown])} r={4} className="spark-dot" />
      </svg>
      {hover !== null && (
        <span className="spark-tip" role="tooltip">
          <strong>×{values[hover].toFixed(2).replace('.', ',')}</strong> {turnsAgo === 0 ? 'nu' : `${turnsAgo} beurt${turnsAgo > 1 ? 'en' : ''} geleden`}
        </span>
      )}
    </span>
  );
}
