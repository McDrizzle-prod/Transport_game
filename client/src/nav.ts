import { useEffect, useState } from 'react';
import { api } from './api';

export function goToGame(gameId: string): void {
  window.location.hash = `#/game/${gameId}`;
}

export function goHome(): void {
  window.location.hash = '#/';
}

/**
 * The address friends use. When the server runs online (through a tunnel, `npm run online`) it tells its
 * public address, so an invite made on the host's own computer (http://localhost) still works for others.
 */
let serverInfo: Promise<{ publicUrl: string | null }> | null = null;

function loadServerInfo(): Promise<{ publicUrl: string | null }> {
  serverInfo ??= api.info().catch(() => ({ publicUrl: null }));
  return serverInfo;
}

export function usePublicUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadServerInfo().then((info) => alive && setUrl(info.publicUrl));
    return () => {
      alive = false;
    };
  }, []);
  return url;
}

export function inviteLink(gameId: string, publicUrl: string | null = null): string {
  const base = publicUrl ? `${publicUrl}/` : `${window.location.origin}${window.location.pathname}`;
  return `${base}#/join/${gameId}`;
}
