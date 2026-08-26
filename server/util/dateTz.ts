//? Timezone-anchored calendar math (D55). Every per-workspace window that a HUMAN reads — the budget
//? month, the usage day buckets, the analytics week, a sprint's start/end day — must be anchored to
//? `Workspace.timezone`, not to UTC: "this month" has to mean the team's month. Owner 2026-08-25:
//? "timezone moet overal gebruikt worden".
//?
//? Dependency-free (Intl only — the house standard, same approach as server/automation/cron.ts and the
//? client-side src/_components/inputs/dateUtils.ts). Every function FAILS CLOSED to UTC on an invalid
//? IANA zone, so a bad stored value degrades to the old behaviour instead of throwing inside a spend
//? write or a snapshot read.

import { tryCatchSync } from '@luckystack/core';

//? A wall-clock calendar day in some zone. Month is 1-12 (not the JS 0-11 footgun).
export interface ZonedDay { year: number; month: number; day: number }

//? Is this a zone `Intl` can actually resolve? The WRITE side validates with it and refuses to store an
//? unusable value — every read below fails closed to UTC, so a bad stored zone would silently un-anchor
//? the whole workspace instead of erroring where the operator can see it.
export function isUsableTimeZone(timeZone: string): boolean {
  if (timeZone.trim().length === 0) return false;
  const [error] = tryCatchSync(() => new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0)));
  return !error;
}

const partsToRecord = (parts: Intl.DateTimeFormatPart[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of parts) { if (part.type !== 'literal') out[part.type] = part.value; }
  return out;
};

//? Offset (ms) to ADD to an instant to get its wall-clock time in `timeZone`. 0 when the zone is
//? unusable — which makes every caller below degrade to UTC rather than throw.
function tzOffsetMs(instant: Date, timeZone: string): number {
  const [error, parts] = tryCatchSync(() => new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant));
  if (error || !parts) return 0;
  const map = partsToRecord(parts);
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
  return asUtc - instant.getTime();
}

//? The wall-clock day an instant falls on in `timeZone`.
export function zonedDay(instant: Date, timeZone: string): ZonedDay {
  const shifted = new Date(instant.getTime() + tzOffsetMs(instant, timeZone));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

//? A wall-clock day (+ optional time) in `timeZone` → the real UTC instant. Two-pass offset resolution,
//? so a day on a DST transition resolves to the correct instant instead of drifting an hour.
export function zonedToUtc(day: ZonedDay, timeZone: string, hour = 0, minute = 0): Date {
  const guess = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
  const offset1 = tzOffsetMs(new Date(guess), timeZone);
  const provisional = guess - offset1;
  const offset2 = tzOffsetMs(new Date(provisional), timeZone);
  return new Date(offset2 === offset1 ? provisional : guess - offset2);
}

//? Midnight on the 1st of the month `now` falls in, in `timeZone` — the budget window's anchor.
export function startOfMonthInTz(timeZone: string, now: Date = new Date()): Date {
  const d = zonedDay(now, timeZone);
  return zonedToUtc({ year: d.year, month: d.month, day: 1 }, timeZone);
}

//? Midnight of the day `now` falls in, in `timeZone`.
export function startOfDayInTz(timeZone: string, now: Date = new Date()): Date {
  return zonedToUtc(zonedDay(now, timeZone), timeZone);
}

//? 'YYYY-MM-DD' for an instant AS SEEN in `timeZone` — the bucket key for per-day aggregation.
export function dayKeyInTz(instant: Date, timeZone: string): string {
  const d = zonedDay(instant, timeZone);
  return `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

//? Weekday index (0 = Sunday) for an instant in `timeZone` — the label for a day bucket.
export function weekdayInTz(instant: Date, timeZone: string): number {
  const shifted = new Date(instant.getTime() + tzOffsetMs(instant, timeZone));
  return shifted.getUTCDay();
}

//? Parse a bare 'YYYY-MM-DD' (what an <input type="date"> emits) as MIDNIGHT IN `timeZone`, not the
//? midnight-UTC that `Date.parse` would give. A full ISO instant is passed through untouched — it
//? already carries its own offset. Returns undefined for anything unparseable.
export function parseDayInTz(raw: string, timeZone: string): Date | undefined {
  const trimmed = raw.trim();
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (bare) {
    const [, y, m, d] = bare;
    return zonedToUtc({ year: Number(y), month: Number(m), day: Number(d) }, timeZone);
  }
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? new Date(ms) : undefined;
}

//? Whole CALENDAR days between two instants as counted in `timeZone` (not rolling 24h blocks): the
//? honest answer to "how many days left in this sprint" when the end date is a wall-clock day.
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  const a = startOfDayInTz(timeZone, from).getTime();
  const b = startOfDayInTz(timeZone, to).getTime();
  return Math.round((b - a) / 86_400_000);
}
