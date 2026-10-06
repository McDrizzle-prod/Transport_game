// Alliances: allied players may use each other's network (roads, tracks, canals and stations).
// Forming one needs an invitation and an acceptance; anybody can leave at any time.
import type { Alliance, GameState, Msg, PlayerId } from './types';

export function allianceOf(state: GameState, player: PlayerId): Alliance | undefined {
  return state.alliances.find((a) => a.members.includes(player));
}

export function areAllied(state: GameState, a: PlayerId, b: PlayerId): boolean {
  return a === b || !!allianceOf(state, a)?.members.includes(b);
}

function hasPlayer(state: GameState, id: PlayerId): boolean {
  return state.players.some((p) => p.id === id);
}

export function inviteToAlliance(state: GameState, from: PlayerId, to: PlayerId, now: number): Msg | null {
  if (from === to || !hasPlayer(state, to)) return { code: 'invalid_player' };
  if (state.phase === 'finished') return { code: 'game_finished' };
  if (allianceOf(state, to)) return { code: 'already_in_alliance' };
  if (areAllied(state, from, to)) return { code: 'already_allied' };
  if (state.invites.some((i) => i.from === from && i.to === to)) return { code: 'already_invited' };
  state.invites.push({ from, to, at: now });
  return null;
}

export function acceptAlliance(state: GameState, player: PlayerId, from: PlayerId): Msg | null {
  const invite = state.invites.find((i) => i.from === from && i.to === player);
  if (!invite) return { code: 'no_invite' };
  if (allianceOf(state, player)) return { code: 'already_in_alliance' };
  let alliance = allianceOf(state, from);
  if (alliance) {
    alliance.members.push(player);
  } else {
    const names = [from, player].map((id) => state.players.find((p) => p.id === id)?.name ?? '?');
    alliance = { id: state.nextId++, name: `${names[0]} & ${names[1]}`, members: [from, player], formedTurn: state.turn };
    state.alliances.push(alliance);
  }
  // Invitations to anybody who is now in an alliance are no longer valid.
  state.invites = state.invites.filter((i) => !allianceOf(state, i.to));
  return null;
}

export function declineAlliance(state: GameState, player: PlayerId, from: PlayerId): Msg | null {
  const before = state.invites.length;
  state.invites = state.invites.filter((i) => !(i.from === from && i.to === player));
  return state.invites.length === before ? { code: 'no_invite' } : null;
}

export function leaveAlliance(state: GameState, player: PlayerId): Msg | null {
  const alliance = allianceOf(state, player);
  if (!alliance) return { code: 'not_in_alliance' };
  alliance.members = alliance.members.filter((m) => m !== player);
  if (alliance.members.length < 2) state.alliances = state.alliances.filter((a) => a !== alliance);
  state.invites = state.invites.filter((i) => i.from !== player);
  return null;
}

/** Fills in fields that games saved by older versions don't have yet. */
export function migrateState(state: GameState): GameState {
  state.alliances ??= [];
  state.invites ??= [];
  return state;
}
