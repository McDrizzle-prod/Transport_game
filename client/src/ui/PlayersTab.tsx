// Players overview, inviting others and (for testing) playing several companies in one browser.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, api } from '../api';
import { money, signedMoney } from '../format';
import { errorText } from '../i18n';
import { identitiesFor, saveIdentity, setActivePlayer } from '../identity';
import { inviteLink, usePublicUrl } from '../nav';
import { useStore, useUi } from '../state/store';

export function PlayersTab() {
  const store = useStore();
  const view = useUi((s) => s.view)!;
  const game = view.game;
  const me = view.you?.playerId;
  const players = [...game.players].sort((a, b) => b.money - a.money);
  const mine = me ? game.alliances.find((a) => a.members.includes(me)) : undefined;
  const allianceOf = (id: string) => game.alliances.find((a) => a.members.includes(id));
  const incoming = me ? game.invites.filter((i) => i.to === me) : [];
  return (
    <section className="panel-section">
      <h3>Spelers</h3>
      {incoming.map((i) => (
        <div key={i.from} className="invite-card">
          <span>
            🤝 <strong>{store.playerName(i.from)}</strong> stelt een alliantie voor
            {allianceOf(i.from) ? ` (${allianceOf(i.from)!.name})` : ''}.
          </span>
          <div className="button-row">
            <button className="secondary" onClick={() => void store.alliance('decline', i.from)}>
              Weigeren
            </button>
            <button className="primary" onClick={() => void store.alliance('accept', i.from)}>
              Accepteren
            </button>
          </div>
        </div>
      ))}
      <ul className="players">
        {players.map((p) => {
          const net = p.last ? p.last.end - p.last.start : null;
          const theirs = allianceOf(p.id);
          const allied = !!mine && mine.members.includes(p.id) && p.id !== me;
          const invited = !!me && game.invites.some((i) => i.from === me && i.to === p.id);
          const canInvite = !!me && p.id !== me && !allied && !invited && !theirs && game.phase !== 'finished';
          return (
            <li key={p.id} className={p.id === me ? 'me' : ''}>
              <i className="dot-color big" style={{ background: p.color }} />
              <div className="player-main">
                <strong>
                  {p.name}
                  {p.id === me && <span className="badge slotbadge">jij</span>}
                  {p.isHost && <span className="badge">host</span>}
                  {allied && <span className="badge ok">🤝 bondgenoot</span>}
                </strong>
                <span className="small muted">
                  {p.hq === null ? 'nog geen hoofdkantoor' : game.phase === 'running' ? (view.ready[p.id] ? '✅ klaar' : '⏳ nog bezig') : '🏢 geplaatst'}
                  {theirs && !allied && p.id !== me ? ` · alliantie ${theirs.name}` : ''}
                </span>
                {canInvite && (
                  <button className="link small" onClick={() => void store.alliance('invite', p.id)}>
                    🤝 alliantie voorstellen
                  </button>
                )}
                {invited && <span className="small muted">voorstel verstuurd…</span>}
              </div>
              <div className="player-money">
                <strong>{money(p.money)}</strong>
                {(p.debt ?? 0) > 0 && <span className="small muted">schuld {money(p.debt)}</span>}
                {net !== null && <span className={`small ${net >= 0 ? 'pos' : 'neg'}`}>{signedMoney(net)}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {mine && (
        <div className="alliance-box">
          <span>
            🤝 Jij zit in alliantie <strong>{mine.name}</strong> (sinds beurt {mine.formedTurn}).
          </span>
          <button className="secondary" onClick={() => void store.alliance('leave')}>
            Verlaten
          </button>
        </div>
      )}
      <p className="muted small">
        Bondgenoten mogen elkaars wegen, sporen, kanalen en stations gebruiken en erop aansluiten. Verlaat iemand de alliantie, dan rijden diens
        voertuigen niet meer over jouw netwerk.
      </p>
      <PinBox />
      <Invite />
      <TestPlayers />
    </section>
  );
}

/** Set or change the PIN that lets the player continue on another device (company name + PIN). */
function PinBox() {
  const store = useStore();
  const you = useUi((s) => s.view?.you);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  if (!you) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await store.setPin(pin)) setPin('');
    setBusy(false);
  };
  return (
    <div className={`pin-box ${you.hasPin ? '' : 'missing'}`}>
      <h4>🔑 Verder spelen op een ander apparaat</h4>
      <p className="small">
        {you.hasPin
          ? 'Je pincode is ingesteld. Op een ander apparaat (of via een nieuwe link van de host) doe je mee met de spelcode, je bedrijfsnaam en je pincode.'
          : 'Je hebt nog geen pincode. Stel er een in: dan kun je op een ander apparaat, of via een nieuwe link van de host, verder spelen met je bedrijfsnaam en pincode.'}
      </p>
      <form className="copy-row" onSubmit={submit}>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder={you.hasPin ? 'Nieuwe pincode' : 'Pincode (4 tot 8 cijfers)'}
          aria-label="Pincode"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
        />
        <button className="secondary" disabled={busy || pin.length < 4}>
          {you.hasPin ? 'Wijzigen' : 'Instellen'}
        </button>
      </form>
    </div>
  );
}

export function Invite() {
  const store = useStore();
  const id = useUi((s) => s.gameId);
  const publicUrl = usePublicUrl();
  const link = inviteLink(id, publicUrl);
  const local = !publicUrl && /^(localhost|127\.|\[::1\])/.test(window.location.hostname);
  const copy = () => {
    const done = () => store.toast('Link gekopieerd', 'ok');
    const fallback = () => {
      // Without https the clipboard API is missing: select the text and use the old copy command.
      const input = document.querySelector<HTMLInputElement>('.invite input');
      input?.select();
      if (document.execCommand?.('copy')) done();
      else store.toast('Kopiëren lukte niet; selecteer de link en kopieer hem zelf', 'error');
    };
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, fallback);
    else fallback();
  };
  return (
    <div className="invite">
      <h4>Uitnodigen</h4>
      <p className="small">
        Deel de code <strong className="code">{id}</strong> of de link:
      </p>
      <div className="copy-row">
        <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Uitnodigingslink" />
        <button className="secondary" onClick={copy}>
          Kopieer
        </button>
        {'share' in navigator && (
          <button
            className="secondary"
            onClick={() => void navigator.share({ title: 'Doe mee met mijn transportspel', text: `Spelcode ${id}`, url: link }).catch(() => undefined)}
          >
            Delen
          </button>
        )}
      </div>
      {publicUrl && <p className="small ok-text">🌍 Deze link werkt ook voor vrienden buiten je wifi.</p>}
      {local && (
        <p className="small warn">
          Dit adres werkt alleen op deze computer. Wil je met vrienden spelen? Start het spel met <code>npm run online</code> (zie de handleiding),
          dan staat hier een link die overal werkt.
        </p>
      )}
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
