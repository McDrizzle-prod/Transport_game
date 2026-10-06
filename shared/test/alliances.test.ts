import { describe, expect, it } from 'vitest';
import { acceptAlliance, declineAlliance, inviteToAlliance, leaveAlliance, resolveTurn } from '../src';
import { addIndustry, hPath, makeWorld, slots, vPath } from './helpers';

describe('alliances', () => {
  it('needs an invitation and an acceptance, and can be left again', () => {
    const w = makeWorld({ width: 20, height: 12, players: ['A', 'B', 'C'] });
    const s = w.state;
    expect(acceptAlliance(s, 'B', 'A')?.code).toBe('no_invite');
    expect(inviteToAlliance(s, 'A', 'B', 0)).toBeNull();
    expect(inviteToAlliance(s, 'A', 'B', 0)?.code).toBe('already_invited');
    expect(inviteToAlliance(s, 'C', 'B', 0)).toBeNull();
    expect(acceptAlliance(s, 'B', 'A')).toBeNull();
    expect(s.alliances).toHaveLength(1);
    expect(s.alliances[0].members).toEqual(['A', 'B']);
    // B is taken now: C's invitation is gone.
    expect(s.invites).toHaveLength(0);
    // C can be invited into the existing alliance.
    expect(inviteToAlliance(s, 'B', 'C', 0)).toBeNull();
    expect(declineAlliance(s, 'C', 'B')).toBeNull();
    expect(inviteToAlliance(s, 'A', 'C', 0)).toBeNull();
    expect(acceptAlliance(s, 'C', 'A')).toBeNull();
    expect(s.alliances[0].members).toEqual(['A', 'B', 'C']);
    expect(leaveAlliance(s, 'A')).toBeNull();
    expect(leaveAlliance(s, 'B')).toBeNull();
    // An alliance of one is no alliance.
    expect(s.alliances).toHaveLength(0);
  });

  it('lets allies drive over each other’s network and stations', () => {
    const w = makeWorld({ width: 32, height: 12 });
    addIndustry(w, 'farm', 2, 4, 60, 60);
    addIndustry(w, 'food_plant', 24, 4);
    const path = hPath(w, 5, 22, 5);
    const built = resolveTurn(w.map, w.state, { A: slots({ type: 'build', kind: 'road', path, stationStart: true, stationEnd: true }) }, 0);
    const buyB = { B: slots({ type: 'vehicles', model: 'truck', from: path[0], to: path[path.length - 1], count: 1 }) };

    // Not allied: B may not use A's stations.
    const alone = resolveTurn(w.map, built.state, buyB, 0);
    expect(alone.report.slots[0].messages[0].code).toBe('station_not_owned');

    const allied = structuredClone(built.state);
    inviteToAlliance(allied, 'A', 'B', 0);
    acceptAlliance(allied, 'B', 'A');
    const t1 = resolveTurn(w.map, allied, buyB, 0);
    expect(t1.report.slots[0].outcome).toBe('ok');
    expect(t1.report.finances.B.revenue).toBeGreaterThan(0);
    expect(t1.state.lines.find((l) => l.owner === 'B')).toBeDefined();

    // After leaving, B's trucks lose their route and stop earning.
    leaveAlliance(t1.state, 'B');
    const t2 = resolveTurn(w.map, t1.state, {}, 0);
    expect(t2.report.finances.B.revenue).toBe(0);
    expect(t2.state.vehicles.find((v) => v.owner === 'B')?.state).toBe('blocked');
  });

  it('lets allies connect to each other’s tiles, which others may not', () => {
    const w = makeWorld({ width: 30, height: 20 });
    const a = hPath(w, 2, 20, 8);
    const first = resolveTurn(w.map, w.state, { A: slots({ type: 'build', kind: 'rail', path: a }) }, 0);
    // B wants a branch that joins A's track at (10, 8).
    const branch = vPath(w, 10, 14, 8);

    const stranger = resolveTurn(w.map, first.state, { B: slots({ type: 'build', kind: 'rail', path: branch }) }, 0);
    expect(stranger.report.slots[0].outcome).toBe('partial');

    const allied = structuredClone(first.state);
    inviteToAlliance(allied, 'B', 'A', 0);
    acceptAlliance(allied, 'A', 'B');
    const friend = resolveTurn(w.map, allied, { B: slots({ type: 'build', kind: 'rail', path: branch }) }, 0);
    expect(friend.report.slots[0].outcome).toBe('ok');
    expect(friend.report.slots[0].built).toHaveLength(branch.length - 1);
    // The joined tile still belongs to A.
    expect(friend.state.infra.tiles[w.at(10, 8)].owners).toEqual(['A']);
  });
});
