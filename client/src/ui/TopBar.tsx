import { countdown, money, moneyShort, when } from '../format';
import { goHome } from '../nav';
import { useStore, useUi } from '../state/store';
import { useNow } from './hooks';

export function TopBar() {
  const store = useStore();
  const view = useUi((s) => s.view)!;
  const connection = useUi((s) => s.connection);
  const clockOffset = useUi((s) => s.clockOffset);
  const now = useNow(1000) + clockOffset;
  const game = view.game;
  const me = game.players.find((p) => p.id === view.you?.playerId);
  const net = me?.last ? me.last.end - me.last.start : null;
  const schedule = game.settings.schedule;

  let timing: string;
  if (game.phase === 'lobby') timing = 'Wachtkamer';
  else if (game.deadline) timing = `${countdown(game.deadline - now)}`;
  else timing = 'handmatig';
  const timingTitle =
    game.deadline !== null
      ? `Volgende uitvoering: ${when(game.deadline)}${schedule.mode === 'daily' ? ` (elke dag om ${schedule.time})` : ''}`
      : 'De host voert de beurt uit';
  const readyCount = Object.values(view.ready).filter(Boolean).length;
  const active = game.players.filter((p) => p.hq !== null).length;

  return (
    <header className="topbar">
      <button className="icon-btn" onClick={goHome} title="Naar het startscherm" aria-label="Terug">
        ←
      </button>
      <div className="tb-title">
        <strong>{game.name}</strong>
        <span>
          {game.phase === 'running' ? `Beurt ${game.turn}` : 'Nog niet gestart'} · code <b>{game.id}</b>
        </span>
      </div>
      <div className="tb-deadline" title={timingTitle}>
        <span className="tb-label">{game.phase === 'running' ? 'Uitvoering over' : 'Status'}</span>
        <strong>⏱ {timing}</strong>
      </div>
      {game.phase === 'running' && (
        <button className="tb-ready" onClick={() => store.setTab('players')} title="Spelers die klaar zijn">
          ✅ {readyCount}/{active}
        </button>
      )}
      <div className="tb-money" title={me?.last ? `Vorige beurt: ${money(net ?? 0)}` : undefined}>
        {me ? (
          <>
            <strong className={me.money < 0 ? 'neg' : ''}>{moneyShort(me.money)}</strong>
            {net !== null && <span className={net >= 0 ? 'pos' : 'neg'}>{(net >= 0 ? '+' : '') + moneyShort(net)}</span>}
          </>
        ) : (
          <span>Toeschouwer</span>
        )}
      </div>
      <span className={`conn ${connection}`} title={connection === 'online' ? 'Verbonden' : 'Verbinding herstellen…'} />
    </header>
  );
}
