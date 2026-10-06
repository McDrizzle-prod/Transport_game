// The 5 action slots plus the panel of the active tool.
import { ACTION_SLOTS, estimateLine } from '@transport/shared';
import type { Action, SlotResult } from '@transport/shared';
import { money } from '../format';
import { OUTCOME_TEXT, actionTitle, msgText } from '../i18n';
import { useStore, useUi } from '../state/store';
import { useNow } from './hooks';
import { HqToolPanel, RouteToolPanel, StationToolPanel, VehicleToolPanel } from './ToolPanels';

export function ActionsTab() {
  const tool = useUi((s) => s.tool);
  const view = useUi((s) => s.view)!;
  const me = view.game.players.find((p) => p.id === view.you?.playerId);
  if (!me) {
    return (
      <div className="panel-section">
        <p className="muted">Je kijkt mee als toeschouwer. Doe mee via het startscherm om zelf te spelen.</p>
      </div>
    );
  }
  if (me.hq === null) return <HqToolPanel />;
  return (
    <>
      {tool.kind === 'route' && <RouteToolPanel />}
      {tool.kind === 'station' && <StationToolPanel />}
      {tool.kind === 'vehicles' && <VehicleToolPanel />}
      <SlotList />
    </>
  );
}

const SYNC_TEXT = { saved: '✓ Opgeslagen', dirty: '… wijzigingen', saving: '↻ Opslaan…', error: '⚠ Niet opgeslagen' } as const;

function SlotList() {
  const store = useStore();
  const draft = useUi((s) => s.draft);
  const ready = useUi((s) => s.ready);
  const sync = useUi((s) => s.sync);
  const view = useUi((s) => s.view)!;
  const highlight = useUi((s) => s.highlightSlot);
  const clockOffset = useUi((s) => s.clockOffset);
  const now = useNow(1000) + clockOffset;
  const preview = store.preview();
  const me = store.me()!;
  const total = (preview?.results ?? []).reduce((sum, r) => sum + (r?.cost ?? 0), 0);
  const left = me.money - total;
  const deadline = view.game.deadline;

  return (
    <section className="panel-section">
      <div className="section-head">
        <h3>Jouw acties · beurt {view.game.turn}</h3>
        <span className={`sync ${sync}`}>{SYNC_TEXT[sync]}</span>
      </div>
      <p className="hint">
        Slot 1 gaat eerst, tegelijk met slot 1 van alle andere spelers. Bouwen twee spelers op dezelfde tegel, dan wint het laagste slot; bij
        hetzelfde slot delen ze de tegel.
      </p>
      <ol className="slots">
        {draft.map((a, i) => (
          <SlotRow key={i} index={i} action={a} result={preview?.results[i] ?? null} highlighted={highlight === i} />
        ))}
      </ol>
      <div className="slots-total">
        <span>
          Kosten <strong>{money(total)}</strong>
        </span>
        <span className={left < 0 ? 'neg' : ''}>
          Over na bouwen <strong>{money(left)}</strong>
        </span>
      </div>
      <div className="ready-row">
        <label className={`ready-toggle ${ready ? 'on' : ''}`}>
          <input type="checkbox" checked={ready} onChange={(e) => store.setReady(e.target.checked)} />
          <span>{ready ? 'Klaar! Je acties staan klaar' : 'Markeer als klaar'}</span>
        </label>
        <span className="muted small">
          {deadline ? `Uitvoering over ${formatShort(deadline - now)}` : 'De host voert de beurt uit'}
          {view.game.settings.resolveWhenAllReady ? ' · of zodra iedereen klaar is' : ''}
        </span>
      </div>
      {view.you?.isHost && (
        <button className="secondary wide" onClick={() => void store.resolveNow()}>
          ⏭ Beurt nu uitvoeren <span className="muted small">(host / testen)</span>
        </button>
      )}
      <p className="muted small">Je acties worden automatisch op de server bewaard; je kunt ze tot de uitvoering aanpassen.</p>
    </section>
  );
}

function formatShort(ms: number): string {
  if (ms <= 0) return 'enkele seconden';
  const m = Math.floor(ms / 60000);
  if (m < 1) return `${Math.ceil(ms / 1000)} s`;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} u ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} u`;
}

function SlotRow({ index, action, result, highlighted }: { index: number; action: Action | null; result: SlotResult | null; highlighted: boolean }) {
  const store = useStore();
  const width = useUi((s) => s.map!.width);
  if (!action) {
    return (
      <li className="slot empty">
        <span className="slot-num">{index + 1}</span>
        <span className="slot-empty-text">Leeg · kies een gereedschap op de kaart</span>
      </li>
    );
  }
  const status = result?.outcome ?? 'ok';
  const messages = (result?.messages ?? []).filter((m) => m.code !== 'nothing_to_build' || result?.built.length === 0);
  let estimate: string | null = null;
  if (action.type === 'vehicles') {
    const world = store.preview()?.world;
    const me = store.me();
    const est = world && me ? estimateLine(world, me.id, action.model, action.from, action.to, action.count) : null;
    if (est && est.connected) estimate = `≈ ${money(est.netPerTurn)} netto per beurt`;
  }
  return (
    <li className={`slot ${status} ${highlighted ? 'highlighted' : ''}`} onClick={() => store.highlight(index)}>
      <span className="slot-num">{index + 1}</span>
      <div className="slot-body">
        <div className="slot-title">{actionTitle(action, width)}</div>
        <div className="slot-sub">
          <span>{(result?.cost ?? 0) < 0 ? `${money(-(result?.cost ?? 0))} terug` : money(result?.cost ?? 0)}</span>
          <span className={`badge ${status}`}>{status === 'ok' ? 'Haalbaar' : OUTCOME_TEXT[status]}</span>
          {estimate && <span className="estimate">{estimate}</span>}
        </div>
        {messages.length > 0 && (
          <ul className="slot-msgs">
            {messages.map((m, k) => (
              <li key={k}>{msgText(m, store.playerName)}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="slot-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" title="Eerder uitvoeren" disabled={index === 0} onClick={() => store.moveSlot(index, -1)}>
          ▲
        </button>
        <button className="icon-btn" title="Later uitvoeren" disabled={index === ACTION_SLOTS - 1} onClick={() => store.moveSlot(index, 1)}>
          ▼
        </button>
        <button className="icon-btn" title="Bewerken" disabled={action.type === 'sell'} onClick={() => store.editSlot(index)}>
          ✎
        </button>
        <button className="icon-btn danger" title="Verwijderen" onClick={() => store.removeSlot(index)}>
          ✕
        </button>
      </div>
    </li>
  );
}
