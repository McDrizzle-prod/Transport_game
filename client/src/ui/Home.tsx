// Start screen: create a game, join with a code, or continue one of your games.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { DEFAULT_ACTION_SLOTS, DEFAULT_START_MONEY, MAP_SIZES, MAX_ACTION_SLOTS, MIN_ACTION_SLOTS, PLAYER_COLORS } from '@transport/shared';
import type { GameSummary, TurnSchedule } from '@transport/shared';
import { ApiError, api } from '../api';
import { GAME_TITLE, errorText } from '../i18n';
import { allIdentities, forgetGame, saveIdentity } from '../identity';
import type { Identity } from '../identity';
import { goToGame, usePublicUrl } from '../nav';

const MAP_LABELS: Record<number, string> = { 48: 'Klein (48×48)', 64: 'Normaal (64×64)', 96: 'Groot (96×96)' };

function ColorPicker({ value, onChange, taken = [] }: { value: string; onChange: (c: string) => void; taken?: string[] }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Kleur">
      {PLAYER_COLORS.map((c) => (
        <button
          type="button"
          key={c}
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          disabled={taken.includes(c)}
          className={`swatch ${value === c ? 'active' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

export function Home({ joinCode, create }: { joinCode: string | null; create: boolean }) {
  const [games, setGames] = useState<Identity[]>(allIdentities);
  const [creating, setCreating] = useState(create);
  const publicUrl = usePublicUrl();
  const online = publicUrl && !window.location.href.startsWith(publicUrl);
  // New players land on joining (with the code from the link filled in); returning players see their games first.
  const myGames = games.length > 0 && (
    <section className="card">
      <h2>Mijn spellen</h2>
      <ul className="game-list">
        {games.map((g) => (
          <li key={`${g.gameId}-${g.playerId}`}>
            <button className="game-link" onClick={() => goToGame(g.gameId)}>
              <strong>{g.gameName ?? g.gameId}</strong>
              <span>
                {g.name} · code {g.gameId}
              </span>
            </button>
            <button
              className="icon-btn"
              title="Vergeet dit spel op dit apparaat"
              onClick={() => {
                forgetGame(g.gameId);
                setGames(allIdentities());
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div className="home">
      <header className="home-hero">
        <div className="logo" aria-hidden>
          🚂
        </div>
        <div>
          <h1>{GAME_TITLE}</h1>
          <p>
            Bouw spoorlijnen, wegen en vaarroutes tussen industrieën en steden. Iedere speler plant zijn acties per beurt; op een vast tijdstip
            worden de acties van iedereen tegelijk uitgevoerd.
          </p>
        </div>
      </header>
      {online && (
        <p className="online-banner">
          🌍 Het spel staat online. Vrienden doen mee via <strong>{publicUrl}</strong> (of de uitnodigingslink in het spel).
        </p>
      )}
      <main className="home-grid">
        {!joinCode && myGames}
        <JoinCard initialCode={joinCode} />
        {joinCode && myGames}
        {creating ? (
          <CreateCard onCancel={() => setCreating(false)} />
        ) : (
          <section className="card">
            <h2>Zelf een spel maken?</h2>
            <p className="muted">Maak een nieuw spel en nodig je vrienden uit met de spelcode of de uitnodigingslink.</p>
            <button className="secondary wide" onClick={() => setCreating(true)}>
              ＋ Nieuw spel maken
            </button>
          </section>
        )}
      </main>
      <footer className="home-footer muted">Proof of concept · werkt in de browser en als app (Toevoegen aan beginscherm)</footer>
    </div>
  );
}

/** PIN field: lets a player continue on another device (or via a new link) with their company name + PIN. */
function PinField({ value, onChange, existing }: { value: string; onChange: (v: string) => void; existing: boolean }) {
  return (
    <label>
      {existing ? 'Jouw pincode' : 'Kies een pincode (4 tot 8 cijfers)'}
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="\d{4,8}"
        minLength={4}
        maxLength={8}
        required
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
      />
      <small className="muted">
        {existing
          ? 'Met je bedrijfsnaam en pincode speel je verder, ook op een ander apparaat.'
          : 'Hiermee speel je later verder op een ander apparaat of via een nieuwe link. Gebruik niet je bankpincode.'}
      </small>
    </label>
  );
}

function CreateCard({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState('Mijn transportspel');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('transportrijk.name') ?? '');
  const [pin, setPin] = useState('');
  const [color, setColor] = useState<string>(PLAYER_COLORS[0]);
  const [mapSize, setMapSize] = useState(64);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [actionSlots, setActionSlots] = useState(DEFAULT_ACTION_SLOTS);
  const [mode, setMode] = useState<TurnSchedule['mode']>('daily');
  const [time, setTime] = useState('20:00');
  const [minutes, setMinutes] = useState(60);
  const [early, setEarly] = useState(false);
  const [seed, setSeed] = useState('');
  const [startMoney, setStartMoney] = useState(DEFAULT_START_MONEY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const schedule: TurnSchedule =
      mode === 'daily'
        ? { mode, time, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
        : mode === 'interval'
          ? { mode, minutes }
          : { mode };
    try {
      const res = await api.createGame({
        name,
        playerName,
        color,
        pin,
        settings: {
          mapSize,
          maxPlayers,
          actionSlots,
          schedule,
          resolveWhenAllReady: early,
          startMoney,
          ...(seed.trim() ? { seed: Number.parseInt(seed, 10) || 0 } : {}),
        },
      });
      localStorage.setItem('transportrijk.name', playerName);
      saveIdentity({ ...res, name: playerName, gameName: name, joinedAt: Date.now() });
      goToGame(res.gameId);
    } catch (err) {
      setError(errorText(err instanceof ApiError ? err.code : 'network'));
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="section-head">
        <h2>Nieuw spel</h2>
        <button type="button" className="link small" onClick={onCancel}>
          sluiten
        </button>
      </div>
      <form onSubmit={submit} className="form">
        <label>
          Naam van het spel
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <label>
          Jouw bedrijfsnaam
          <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={24} required placeholder="bv. Rail & Co" />
        </label>
        <PinField value={pin} onChange={setPin} existing={false} />
        <div className="field">
          <span>Kleur</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <div className="row2">
          <label>
            Kaart
            <select value={mapSize} onChange={(e) => setMapSize(Number(e.target.value))}>
              {MAP_SIZES.map((s) => (
                <option key={s} value={s}>
                  {MAP_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Max. spelers
            <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Acties per beurt
          <select value={actionSlots} onChange={(e) => setActionSlots(Number(e.target.value))}>
            {Array.from({ length: MAX_ACTION_SLOTS - MIN_ACTION_SLOTS + 1 }, (_, i) => MIN_ACTION_SLOTS + i).map((n) => (
              <option key={n} value={n}>
                {n} acties
              </option>
            ))}
          </select>
          <small className="muted">Elk stuk weg of spoor en elk station kost 1 actie. Meer acties = sneller bouwen.</small>
        </label>
        <fieldset>
          <legend>Wanneer wordt een beurt uitgevoerd?</legend>
          <label className="radio">
            <input type="radio" checked={mode === 'daily'} onChange={() => setMode('daily')} />
            Elke dag om
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={mode !== 'daily'} />
          </label>
          <label className="radio">
            <input type="radio" checked={mode === 'interval'} onChange={() => setMode('interval')} />
            Elke
            <input
              type="number"
              min={1}
              max={1440}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              disabled={mode !== 'interval'}
              className="narrow"
            />
            minuten
          </label>
          <label className="radio">
            <input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} />
            Alleen als de host op “uitvoeren” drukt
          </label>
          <label className="check">
            <input type="checkbox" checked={early} onChange={(e) => setEarly(e.target.checked)} />
            Eerder uitvoeren zodra alle spelers klaar zijn
          </label>
        </fieldset>
        <details>
          <summary>Geavanceerd</summary>
          <div className="row2">
            <label>
              Seed (kaart)
              <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} placeholder="willekeurig" />
            </label>
            <label>
              Startkapitaal (€)
              <input type="number" min={100000} step={100000} value={startMoney} onChange={(e) => setStartMoney(Number(e.target.value))} />
            </label>
          </div>
        </details>
        {error && <p className="error">{error}</p>}
        <button className="primary big" disabled={busy || !playerName.trim() || pin.length < 4}>
          {busy ? 'Kaart wordt gemaakt…' : 'Spel maken'}
        </button>
      </form>
    </section>
  );
}

/**
 * Join a game with its code: as a new company, or (same name + PIN) continue as an existing one, e.g. on
 * another device or after the host's link changed.
 */
export function JoinCard({ initialCode, onJoined, fixedCode = false }: { initialCode: string | null; onJoined?: (gameId: string) => void; fixedCode?: boolean }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [summary, setSummary] = useState<GameSummary | null>(null);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('transportrijk.name') ?? '');
  const [pin, setPin] = useState('');
  const [color, setColor] = useState<string>(PLAYER_COLORS[1]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = code.trim().toUpperCase();
    setSummary(null);
    if (c.length !== 6) return;
    let cancelled = false;
    api
      .summary(c)
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setError(null);
        const taken = s.players.map((p) => p.color);
        setColor((prev) => (taken.includes(prev) ? (PLAYER_COLORS.find((x) => !taken.includes(x)) ?? prev) : prev));
      })
      .catch((err) => !cancelled && setError(errorText(err instanceof ApiError ? err.code : 'network')));
    return () => {
      cancelled = true;
    };
  }, [code]);

  // A name that is already in the game: this is somebody continuing (with their PIN).
  const existing = summary?.players.find((p) => p.name.toLowerCase() === playerName.trim().toLowerCase());
  const full = !!summary && summary.players.length >= summary.maxPlayers && !existing;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = code.trim().toUpperCase();
    setBusy(true);
    setError(null);
    try {
      const res = await api.join(id, { name: playerName, color, pin });
      localStorage.setItem('transportrijk.name', playerName.trim());
      saveIdentity({ ...res, name: existing?.name ?? playerName.trim(), gameName: summary?.name, joinedAt: Date.now() });
      if (onJoined) onJoined(res.gameId);
      else goToGame(res.gameId);
    } catch (err) {
      setError(errorText(err instanceof ApiError ? err.code : 'network'));
      setBusy(false);
    }
  };

  return (
    <section className="card accent">
      <h2>Meedoen met een spel</h2>
      <form onSubmit={submit} className="form">
        {fixedCode ? (
          <p className="join-code">
            Spelcode <strong className="code">{code}</strong>
          </p>
        ) : (
          <label>
            Spelcode
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="bv. K7Q2PX"
              className="code-input"
              autoCapitalize="characters"
              aria-label="Spelcode"
            />
          </label>
        )}
        {summary && (
          <div className="summary">
            <strong>{summary.name}</strong> · {summary.phase === 'lobby' ? 'wachtkamer' : `beurt ${summary.turn}`} · {summary.players.length}/
            {summary.maxPlayers} spelers
            {summary.players.length > 0 && (
              <>
                <div className="chips">
                  {summary.players.map((p) => (
                    <button type="button" key={p.name} className="chip" onClick={() => setPlayerName(p.name)} title="Dit ben ik: verder spelen">
                      <i style={{ background: p.color }} />
                      {p.name}
                    </button>
                  ))}
                </div>
                <small className="muted">Speelde je al mee? Tik op je naam en vul je pincode in.</small>
              </>
            )}
          </div>
        )}
        <label>
          Jouw bedrijfsnaam
          <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={24} required placeholder="bv. Spoor & Zonen" />
        </label>
        <PinField value={pin} onChange={setPin} existing={!!existing} />
        {!existing && (
          <div className="field">
            <span>Kleur</span>
            <ColorPicker value={color} onChange={setColor} taken={summary?.players.map((p) => p.color)} />
          </div>
        )}
        {full && <p className="error">Dit spel zit vol.</p>}
        {error && <p className="error">{error}</p>}
        <button className="primary big" disabled={busy || code.length !== 6 || !playerName.trim() || pin.length < 4 || full}>
          {existing ? `Verder spelen als ${existing.name}` : 'Meedoen'}
        </button>
      </form>
    </section>
  );
}
