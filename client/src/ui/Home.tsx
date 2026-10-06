// Start screen: create a game, join with a code, or continue one of your games.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { DEFAULT_START_MONEY, MAP_SIZES, PLAYER_COLORS } from '@transport/shared';
import type { GameSummary, TurnSchedule } from '@transport/shared';
import { ApiError, api } from '../api';
import { GAME_TITLE, errorText } from '../i18n';
import { allIdentities, forgetGame, saveIdentity } from '../identity';
import type { Identity } from '../identity';
import { goToGame } from '../nav';

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

export function Home({ joinCode }: { joinCode: string | null }) {
  const [games, setGames] = useState<Identity[]>(allIdentities);
  return (
    <div className="home">
      <header className="home-hero">
        <div className="logo" aria-hidden>
          🚂
        </div>
        <div>
          <h1>{GAME_TITLE}</h1>
          <p>
            Bouw spoorlijnen, wegen en vaarroutes tussen industrieën en steden. Iedere speler plant 5 acties per beurt; op
            een vast tijdstip worden alle acties tegelijk uitgevoerd.
          </p>
        </div>
      </header>
      <main className="home-grid">
        <JoinCard initialCode={joinCode} />
        <CreateCard />
        <section className="card">
          <h2>Mijn spellen</h2>
          {games.length === 0 && <p className="muted">Nog geen spellen op dit apparaat.</p>}
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
      </main>
      <footer className="home-footer muted">Proof of concept · werkt in de browser en als app (Toevoegen aan beginscherm)</footer>
    </div>
  );
}

function CreateCard() {
  const [name, setName] = useState('Mijn transportspel');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('transportrijk.name') ?? '');
  const [color, setColor] = useState<string>(PLAYER_COLORS[0]);
  const [mapSize, setMapSize] = useState(64);
  const [maxPlayers, setMaxPlayers] = useState(4);
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
        settings: {
          mapSize,
          maxPlayers,
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
      <h2>Nieuw spel</h2>
      <form onSubmit={submit} className="form">
        <label>
          Naam van het spel
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <label>
          Jouw bedrijfsnaam
          <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={24} required placeholder="bv. Rail & Co" />
        </label>
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
        <button className="primary big" disabled={busy || !playerName.trim()}>
          {busy ? 'Kaart wordt gemaakt…' : 'Spel maken'}
        </button>
      </form>
    </section>
  );
}

function JoinCard({ initialCode }: { initialCode: string | null }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [summary, setSummary] = useState<GameSummary | null>(null);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('transportrijk.name') ?? '');
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = code.trim().toUpperCase();
    const mine = allIdentities().find((i) => i.gameId === id);
    if (mine && !playerName.trim()) return goToGame(id);
    setBusy(true);
    setError(null);
    try {
      const res = await api.join(id, { name: playerName, color });
      localStorage.setItem('transportrijk.name', playerName);
      saveIdentity({ ...res, name: playerName, gameName: summary?.name, joinedAt: Date.now() });
      goToGame(res.gameId);
    } catch (err) {
      setError(errorText(err instanceof ApiError ? err.code : 'network'));
      setBusy(false);
    }
  };

  return (
    <section className="card accent">
      <h2>Meedoen met een spel</h2>
      <form onSubmit={submit} className="form">
        <label>
          Spelcode
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="bv. K7Q2PX"
            className="code-input"
            autoCapitalize="characters"
          />
        </label>
        {summary && (
          <div className="summary">
            <strong>{summary.name}</strong> · {summary.phase === 'lobby' ? 'wachtkamer' : `beurt ${summary.turn}`} · {summary.players.length}/
            {summary.maxPlayers} spelers
            <div className="chips">
              {summary.players.map((p) => (
                <span key={p.name} className="chip">
                  <i style={{ background: p.color }} />
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}
        <label>
          Jouw bedrijfsnaam
          <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} maxLength={24} required />
        </label>
        <div className="field">
          <span>Kleur</span>
          <ColorPicker value={color} onChange={setColor} taken={summary?.players.map((p) => p.color)} />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary big" disabled={busy || code.length !== 6 || !playerName.trim()}>
          Meedoen
        </button>
      </form>
    </section>
  );
}
