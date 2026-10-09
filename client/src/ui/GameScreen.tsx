import { useEffect, useMemo, useState } from 'react';
import { MapView } from '../map/MapView';
import { goHome } from '../nav';
import { GameStore, StoreContext, useUi } from '../state/store';
import { identitiesFor } from '../identity';
import { JoinCard } from './Home';
import { Sheet } from './Sheet';
import { ToolBar } from './ToolBar';
import { RouteBar } from './ToolPanels';
import { TopBar } from './TopBar';

export function GameScreen({ gameId }: { gameId: string }) {
  // Somebody without a company in this game (e.g. opening a shared link) first gets the join form.
  const [mode, setMode] = useState<'play' | 'watch' | 'join'>(() => (identitiesFor(gameId).length > 0 ? 'play' : 'join'));
  if (mode === 'join') return <JoinGate gameId={gameId} onJoined={() => setMode('play')} onWatch={() => setMode('watch')} />;
  return <GameMain key={mode} gameId={gameId} />;
}

function JoinGate({ gameId, onJoined, onWatch }: { gameId: string; onJoined: () => void; onWatch: () => void }) {
  return (
    <div className="home join-gate">
      <header className="home-hero">
        <div className="logo" aria-hidden>
          🚂
        </div>
        <div>
          <h1>Je bent uitgenodigd</h1>
          <p>Kies een naam voor je transportbedrijf en een pincode, en je doet mee.</p>
        </div>
      </header>
      <main className="home-single">
        <JoinCard initialCode={gameId} fixedCode onJoined={onJoined} />
        <p className="muted gate-links">
          <button className="link" onClick={onWatch}>
            Alleen meekijken
          </button>
          {' · '}
          <button className="link" onClick={goHome}>
            Naar het startscherm
          </button>
        </p>
      </main>
    </div>
  );
}

function GameMain({ gameId }: { gameId: string }) {
  const store = useMemo(() => new GameStore(gameId), [gameId]);
  useEffect(() => {
    void store.start();
    return () => store.stop();
  }, [store]);
  return (
    <StoreContext.Provider value={store}>
      <GameLayout />
    </StoreContext.Provider>
  );
}

function GameLayout() {
  const loadError = useUi((s) => s.loadError);
  const ready = useUi((s) => !!s.view && !!s.map);
  const sheetOpen = useUi((s) => s.sheetOpen);
  const routing = useUi((s) => s.tool.kind === 'route');
  if (loadError) {
    return (
      <div className="center-screen">
        <div className="card">
          <h2>Kan het spel niet laden</h2>
          <p>{loadError}</p>
          <button className="primary" onClick={goHome}>
            Terug naar start
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`game ${sheetOpen ? 'sheet-open' : 'sheet-closed'} ${routing ? 'routing' : ''}`}>
      <MapView />
      {ready ? (
        <>
          <TopBar />
          <ToolBar />
          <RouteBar />
          <Sheet />
          <ToastView />
        </>
      ) : (
        <div className="center-screen overlay">
          <div className="spinner" aria-label="Laden" />
        </div>
      )}
    </div>
  );
}

function ToastView() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  return (
    <div key={toast.id} className={`toast ${toast.kind}`} role="status">
      {toast.text}
    </div>
  );
}
