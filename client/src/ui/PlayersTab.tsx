// Players overview, inviting others and (for testing) playing several companies in one browser.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, api } from '../api';
import { money, signedMoney } from '../format';
import { errorText } from '../i18n';
import { identitiesFor, saveIdentity, setActivePlayer } from '../identity';
import { inviteLink } from '../nav';
import { useStore, useUi } from '../state/store';

export function PlayersTab() {
  const view = useUi((s) => s.view)!;
  const game = view.game;
  const me = view.you?.playerId;
  const players = [...game.players].sort((a, b) => b.money - a.money);
  return (
    <section className="panel-section">
      <h3>Spelers</h3>
      <ul className="players">
        {players.map((p) => {
          const net = p.last ? p.last.end - p.last.start : null;
          return (
            <li key={p.id} className={p.id === me ? 'me' : ''}>
              <i className="dot-color big" style={{ background: p.color }} />
              <div className="player-main">
                <strong>
                  {p.name}
                  {p.id === me && <span className="badge slotbadge">jij</span>}
                  {p.isHost && <span className="badge">host</span>}
                </strong>
                <span className="small muted">
                  {p.hq === null ? 'nog geen hoofdkantoor' : game.phase === 'running' ? (view.ready[p.id] ? '✅ klaar' : '⏳ nog bezig') : '🏢 geplaatst'}
                </span>
              </div>
              <div className="player-money">
                <strong>{money(p.money)}</strong>
                {net !== null && <span className={`small ${net >= 0 ? 'pos' : 'neg'}`}>{signedMoney(net)}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      <Invite />
      <TestPlayers />
    </section>
  );
}

export function Invite() {
  const store = useStore();
  const id = useUi((s) => s.gameId);
  const link = inviteLink(id);
  return (
    <div className="invite">
      <h4>Uitnodigen</h4>
      <p className="small">
        Deel de code <strong className="code">{id}</strong> of de link:
      </p>
      <div className="copy-row">
        <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Uitnodigingslink" />
        <button
          className="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(
              () => store.toast('Link gekopieerd', 'ok'),
              () => store.toast('Kopiëren lukte niet; selecteer de link handmatig', 'error'),
            );
          }}
        >
          Kopieer
        </button>
      </div>
    </div>
  );
}

/** Lets one person try the multiplayer rules alone: add companies and switch between them. */
export function TestPlayers() {
  const store = useStore();
  const gameId = useUi((s) => s.gameId);
  const identity = useUi((s) => s.identity);
  const view = useUi((s) => s.view)!;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const mine = identitiesFor(gameId);
  const full = view.game.players.length >= view.game.settings.maxPlayers;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.join(gameId, { name });
      saveIdentity({ ...res, name, gameName: view.game.name, joinedAt: Date.now() });
      window.location.reload();
    } catch (err) {
      store.toast(errorText(err instanceof ApiError ? err.code : 'network'), 'error');
      setBusy(false);
    }
  };

  return (
    <details className="test-players" open={mine.length > 1}>
      <summary>Meerdere bedrijven op dit apparaat (testen)</summary>
      {mine.length > 1 && (
        <div className="switch">
          <span className="small">Speel als:</span>
          {mine.map((i) => (
            <button
              key={i.playerId}
              className={i.playerId === identity?.playerId ? 'secondary active' : 'secondary'}
              onClick={() => {
                setActivePlayer(gameId, i.playerId);
                window.location.reload();
              }}
            >
              {i.name}
            </button>
          ))}
        </div>
      )}
      {!full && (
        <form className="copy-row" onSubmit={add}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Naam extra bedrijf" maxLength={24} required />
          <button className="secondary" disabled={busy || !name.trim()}>
            Toevoegen
          </button>
        </form>
      )}
      <p className="muted small">
        Handig om de regels alleen uit te proberen: maak een tweede bedrijf aan, wissel ertussen en plan voor beide acties. Elk tabblad onthoudt
        met welk bedrijf je speelt.
      </p>
    </details>
  );
}
