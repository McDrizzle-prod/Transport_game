import { useEffect, useMemo } from 'react';
import { MapView } from '../map/MapView';
import { goHome } from '../nav';
import { GameStore, StoreContext, useUi } from '../state/store';
import { Sheet } from './Sheet';
import { ToolBar } from './ToolBar';
import { TopBar } from './TopBar';

export function GameScreen({ gameId }: { gameId: string }) {
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
    <div className={`game ${sheetOpen ? 'sheet-open' : 'sheet-closed'}`}>
      <MapView />
      {ready ? (
        <>
          <TopBar />
          <ToolBar />
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
