// Players are identified by a secret token per game, kept in localStorage.
// The active player per game is kept per tab (sessionStorage), so one browser can test several players.

export interface Identity {
  gameId: string;
  playerId: string;
  token: string;
  name: string;
  gameName?: string;
  joinedAt: number;
}

const KEY = 'transportrijk.identities';

function read(): Identity[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Identity[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: Identity[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage may be unavailable (private mode); the session still works until reload.
  }
}

export function allIdentities(): Identity[] {
  return read().sort((a, b) => b.joinedAt - a.joinedAt);
}

export function identitiesFor(gameId: string): Identity[] {
  return read().filter((i) => i.gameId === gameId);
}

export function saveIdentity(identity: Identity): void {
  write([...read().filter((i) => !(i.gameId === identity.gameId && i.playerId === identity.playerId)), identity]);
  setActivePlayer(identity.gameId, identity.playerId);
}

export function forgetGame(gameId: string): void {
  write(read().filter((i) => i.gameId !== gameId));
}

export function setActivePlayer(gameId: string, playerId: string): void {
  try {
    sessionStorage.setItem(`transportrijk.active.${gameId}`, playerId);
  } catch {
    // ignore
  }
}

export function activeIdentity(gameId: string): Identity | null {
  const list = identitiesFor(gameId);
  let active: string | null = null;
  try {
    active = sessionStorage.getItem(`transportrijk.active.${gameId}`);
  } catch {
    active = null;
  }
  return list.find((i) => i.playerId === active) ?? list[0] ?? null;
}
