import { useEffect, useState } from 'react';
import { GameScreen } from './ui/GameScreen';
import { Home } from './ui/Home';

type Route = { page: 'home'; joinCode: string | null; create: boolean } | { page: 'game'; gameId: string };

function parseHash(): Route {
  const m = /^#\/(game|join)\/([A-Za-z0-9]{4,8})/.exec(window.location.hash);
  if (m?.[1] === 'game') return { page: 'game', gameId: m[2].toUpperCase() };
  return { page: 'home', joinCode: m ? m[2].toUpperCase() : null, create: window.location.hash.startsWith('#/new') };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (route.page === 'game') return <GameScreen key={route.gameId} gameId={route.gameId} />;
  return <Home key={`${route.joinCode}${route.create}`} joinCode={route.joinCode} create={route.create} />;
}
