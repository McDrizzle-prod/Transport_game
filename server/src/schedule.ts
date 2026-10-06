// When is the next turn executed? Supports a fixed time of day (in a time zone), an interval or manual only.
import type { TurnSchedule } from '@transport/shared';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(epochMs: number, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(epochMs))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

/** Offset of the time zone from UTC at a moment, in ms (e.g. +2h for Amsterdam in summer). */
function offsetAt(epochMs: number, timeZone: string): number {
  const p = zonedParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** Epoch ms of a wall-clock time in a time zone. */
export function zonedTimeToEpoch(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let epoch = guess - offsetAt(guess, timeZone);
  const corrected = guess - offsetAt(epoch, timeZone);
  if (corrected !== epoch) epoch = corrected;
  return epoch;
}

/** The next moment (strictly after `now`) at which a turn should be executed, or null for manual games. */
export function nextDeadline(schedule: TurnSchedule, now: number): number | null {
  switch (schedule.mode) {
    case 'manual':
      return null;
    case 'interval':
      return now + schedule.minutes * 60_000;
    case 'daily': {
      const [hh, mm] = schedule.time.split(':').map(Number);
      const today = zonedParts(now, schedule.timeZone);
      let candidate = zonedTimeToEpoch(today.year, today.month, today.day, hh, mm, schedule.timeZone);
      if (candidate <= now) {
        const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
        candidate = zonedTimeToEpoch(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), hh, mm, schedule.timeZone);
      }
      return candidate;
    }
  }
}
