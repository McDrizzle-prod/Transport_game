// A route is planned as one action per segment. Consecutive build actions of the same kind are shown as
// one group (in the slot list and on the map), so a long road doesn't become a long list.
import type { Action, BuildAction, OrderSlots } from '@transport/shared';

export interface SlotGroup {
  /** First and last slot index (0-based, inclusive). */
  start: number;
  end: number;
}

const isBuild = (a: Action | null | undefined): a is BuildAction => a?.type === 'build';

/** Consecutive segments of the same kind that touch each other belong to one route. */
const continues = (prev: Action | null | undefined, a: Action | null | undefined): boolean =>
  isBuild(a) && isBuild(prev) && prev.kind === a.kind && prev.path.some((t) => a.path.includes(t));

export function slotGroups(slots: OrderSlots): SlotGroup[] {
  const groups: SlotGroup[] = [];
  slots.forEach((a, i) => {
    const last = groups[groups.length - 1];
    if (continues(slots[i - 1], a) && last?.end === i - 1) last.end = i;
    else groups.push({ start: i, end: i });
  });
  return groups;
}

/** The tiles of a group of build actions, in order (segments joined where they connect). */
export function groupPath(slots: OrderSlots, g: SlotGroup): number[] {
  const path: number[] = [];
  for (let i = g.start; i <= g.end; i++) {
    const a = slots[i];
    if (!isBuild(a)) continue;
    for (const t of a.path) if (path[path.length - 1] !== t) path.push(t);
  }
  return path;
}

export const slotRange = (g: SlotGroup): string => (g.start === g.end ? String(g.start + 1) : `${g.start + 1}–${g.end + 1}`);
