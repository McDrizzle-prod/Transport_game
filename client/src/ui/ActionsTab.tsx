// The action slots plus the panel of the active tool.
import { useState } from 'react';
import { TRANSPORT, estimateLine } from '@transport/shared';
import type { Action, SlotResult } from '@transport/shared';
import { money, num, tileLabel } from '../format';
import { OUTCOME_TEXT, TRANSPORT_ICON, actionTitle, msgText } from '../i18n';
import { groupPath, slotGroups, slotRange } from '../state/groups';
import type { SlotGroup } from '../state/groups';
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
  const used = draft.filter(Boolean).length;
  // Long rows of empty slots at the end are folded into one line.
  let last = -1;
  draft.forEach((a, i) => {
    if (a) last = i;
  });
  const foldFrom = last + 2;
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const toggle = (start: number) => {
    const next = new Set(expanded);
    if (!next.delete(start)) next.add(start);
    setExpanded(next);
  };
  const row = (i: number) => <SlotRow key={i} index={i} action={draft[i]} result={preview?.results[i] ?? null} highlighted={highlight === i} />;

  return (
    <section className="panel-section">
      <div className="section-head">
        <h3>Jouw acties · beurt {view.game.turn}</h3>
        <span className={`sync ${sync}`}>{SYNC_TEXT[sync]}</span>
      </div>
      <p className="hint">
        {used} van {draft.length} acties gebruikt. Elk stuk weg, spoor of kanaal (van tegel naar tegel) en elk station kost 1 actie. Slot 1 gaat
        eerst, tegelijk met slot 1 van alle andere spelers: bouwen twee spelers op dezelfde tegel, dan wint het laagste slot; bij hetzelfde slot
        delen ze de tegel.
      </p>
      <ol className="slots">
        {slotGroups(draft).map((g) => {
          const i = g.start;
          if (g.end > g.start) {
            // A route of several segments: one row, which can be unfolded.
            const open = expanded.has(g.start);
            return [
              <GroupRow
                key={`g${i}`}
                group={g}
                results={preview?.results ?? []}
                highlighted={highlight !== null && highlight >= g.start && highlight <= g.end}
                open={open}
                onToggle={() => toggle(g.start)}
              />,
              ...(open ? Array.from({ length: g.end - g.start + 1 }, (_, k) => row(g.start + k)) : []),
            ];
          }
          if (i < foldFrom || draft[i]) return row(i);
          if (i !== foldFrom) return null;
          return (
            <li key={i} className="slot empty folded">
              <span className="slot-num">…</span>
              <span className="slot-empty-text">
                Slot {i + 1}–{draft.length} zijn ook nog leeg
              </span>
            </li>
          );
        })}
      </ol>
      {used > 0 && (
        <button className="link small" onClick={() => store.clearSlots()}>
          Alle acties wissen
        </button>
      )}
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

/** Several segments of one route, planned in consecutive slots. */
function GroupRow({
  group,
  results,
  highlighted,
  open,
  onToggle,
}: {
  group: SlotGroup;
  results: (SlotResult | null)[];
  highlighted: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const store = useStore();
  const draft = useUi((s) => s.draft);
  const width = useUi((s) => s.map!.width);
  const first = draft[group.start];
  if (first?.type !== 'build') return null;
  const path = groupPath(draft, group);
  const indices = Array.from({ length: group.end - group.start + 1 }, (_, k) => group.start + k);
  const outcomes = indices.map((i) => results[i]?.outcome ?? 'ok');
  const status = outcomes.every((o) => o === 'ok') ? 'ok' : outcomes.every((o) => o === 'failed') ? 'failed' : 'partial';
  const cost = indices.reduce((sum, i) => sum + (results[i]?.cost ?? 0), 0);
  const problems = indices.flatMap((i) =>
    (results[i]?.messages ?? []).filter((m) => m.code !== 'nothing_to_build').map((m) => `Slot ${i + 1}: ${msgText(m, store.playerName)}`),
  );
  return (
    <li className={`slot group ${status} ${highlighted ? 'highlighted' : ''}`} onClick={() => store.highlight(Math.floor((group.start + group.end) / 2))}>
      <span className="slot-num range">{slotRange(group)}</span>
      <div className="slot-body">
        <div className="slot-title">
          {TRANSPORT_ICON[first.kind]} {TRANSPORT[first.kind].name} {tileLabel(path[0], width)} → {tileLabel(path[path.length - 1], width)}
        </div>
        <div className="slot-sub">
          <span>
            {num(indices.length)} stukken = {num(indices.length)} acties · {money(cost)}
          </span>
          <span className={`badge ${status}`}>{status === 'ok' ? 'Haalbaar' : OUTCOME_TEXT[status]}</span>
        </div>
        {problems.length > 0 && (
          <ul className="slot-msgs">
            {problems.slice(0, 3).map((p, k) => (
              <li key={k}>{p}</li>
            ))}
            {problems.length > 3 && <li>… en {problems.length - 3} meer</li>}
          </ul>
        )}
      </div>
      <div className="slot-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" title={open ? 'Inklappen' : 'Per stuk tonen'} aria-label={open ? 'Inklappen' : 'Per stuk tonen'} onClick={onToggle}>
          {open ? '▴' : '▾'}
        </button>
        <button className="icon-btn danger" title="Hele route verwijderen" aria-label="Hele route verwijderen" onClick={() => store.removeSlots(group.start, group.end)}>
          ✕
        </button>
      </div>
    </li>
  );
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
        <button className="icon-btn" title="Later uitvoeren" disabled={index === store.slotCount() - 1} onClick={() => store.moveSlot(index, 1)}>
          ▼
        </button>
        {(action.type === 'station' || action.type === 'vehicles') && (
          <button className="icon-btn" title="Bewerken" onClick={() => store.editSlot(index)}>
            ✎
          </button>
        )}
        <button className="icon-btn danger" title="Verwijderen" onClick={() => store.removeSlot(index)}>
          ✕
        </button>
      </div>
    </li>
  );
}
