// Before the game starts: place headquarters, invite players, host starts the game.
import { DEFAULT_ACTION_SLOTS, DEFAULT_START_MONEY } from '@transport/shared';
import { money } from '../format';
import { useStore, useUi } from '../state/store';
import { Invite, TestPlayers } from './PlayersTab';
import { HqToolPanel } from './ToolPanels';

export function LobbyTab() {
  const store = useStore();
  const view = useUi((s) => s.view)!;
  const tool = useUi((s) => s.tool);
  const game = view.game;
  const me = game.players.find((p) => p.id === view.you?.playerId);
  const s = game.settings;
  const schedule =
    s.schedule.mode === 'daily'
      ? `elke dag om ${s.schedule.time} (${s.schedule.timeZone})`
      : s.schedule.mode === 'interval'
        ? `elke ${s.schedule.minutes} minuten`
        : 'wanneer de host op “uitvoeren” drukt';
  const placed = game.players.filter((p) => p.hq !== null).length;

  return (
    <section className="panel-section lobby">
      <h3>Wachtkamer</h3>
      <ol className="steps">
        <li className={me?.hq !== null && me ? 'done' : ''}>
          Plaats je hoofdkantoor op de kaart
          {me?.hq !== null && me && tool.kind !== 'hq' && (
            <button className="link" onClick={() => store.setTool({ kind: 'hq' })}>
              verplaatsen
            </button>
          )}
        </li>
        <li className={game.players.length > 1 ? 'done' : ''}>Nodig andere spelers uit ({game.players.length}/{s.maxPlayers})</li>
        <li>De host start het spel</li>
      </ol>
      {me && (me.hq === null || tool.kind === 'hq') && <HqToolPanel />}
      <dl className="stats">
        <dt>Kaart</dt>
        <dd>
          {s.mapSize}×{s.mapSize} · seed {s.seed}
        </dd>
        <dt>Uitvoering</dt>
        <dd>
          {schedule}
          {s.resolveWhenAllReady ? ', of eerder als iedereen klaar is' : ''}
        </dd>
        <dt>Acties per beurt</dt>
        <dd>{s.actionSlots ?? DEFAULT_ACTION_SLOTS}</dd>
        <dt>Startkapitaal</dt>
        <dd>{money(s.startMoney ?? DEFAULT_START_MONEY)}</dd>
        <dt>Hoofdkantoren</dt>
        <dd>
          {placed} van {game.players.length} geplaatst
        </dd>
      </dl>
      {view.you?.isHost ? (
        <button className="primary wide big" disabled={placed === 0} onClick={() => void store.startGame()}>
          ▶ Start het spel
        </button>
      ) : (
        <p className="muted">Wacht tot de host het spel start.</p>
      )}
      <Invite />
      <TestPlayers />
    </section>
  );
}
