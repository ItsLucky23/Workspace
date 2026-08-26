//? D55 — the timezone-anchored calendar math every human-facing window now runs on (budget month, usage
//? day buckets, analytics week, sprint days). Pure, no DB. The cases that matter are the ones where the
//? naive "just use UTC" answer is WRONG: an instant that falls on a different calendar day in the target
//? zone, a DST transition, and a stored zone the runtime cannot resolve (which must degrade, never throw).
import {
  calendarDaysBetween, dayKeyInTz, isUsableTimeZone, parseDayInTz,
  startOfDayInTz, startOfMonthInTz, weekdayInTz, zonedDay, zonedToUtc,
} from '../../server/util/dateTz.ts';
import { computeAnalytics } from '../../server/obs/analytics.ts';
import { eq, report } from '../_helpers.mts';

const AMS = 'Europe/Amsterdam';
const TOKYO = 'Asia/Tokyo';

// zonedDay — 23:30 UTC is already the NEXT day in Tokyo (+9). This off-by-one day is the whole point.
const lateUtc = new Date('2026-03-10T23:30:00Z');
eq(dayKeyInTz(lateUtc, 'UTC'), '2026-03-10', 'UTC reads the instant as the 10th');
eq(dayKeyInTz(lateUtc, TOKYO), '2026-03-11', 'Tokyo reads the same instant as the 11th');
eq(zonedDay(lateUtc, TOKYO).day, 11, 'zonedDay agrees with dayKeyInTz');

// weekdayInTz — same instant, different weekday index either side of the date line shift.
eq(weekdayInTz(lateUtc, 'UTC'), 2, '2026-03-10 UTC is a Tuesday');
eq(weekdayInTz(lateUtc, TOKYO), 3, 'the same instant is Wednesday in Tokyo');

// zonedToUtc — winter is UTC+1 in Amsterdam, summer UTC+2. A single fixed offset would be wrong for one
// of these two, which is why the resolution is two-pass rather than "add the current offset".
eq(zonedToUtc({ year: 2026, month: 1, day: 15 }, AMS).toISOString(), '2026-01-14T23:00:00.000Z', 'winter midnight in Amsterdam is 23:00Z the day before');
eq(zonedToUtc({ year: 2026, month: 7, day: 15 }, AMS).toISOString(), '2026-07-14T22:00:00.000Z', 'summer midnight in Amsterdam is 22:00Z the day before');
// The DST transition day itself (last Sunday of March 2026 = the 29th): midnight is still CET (+1).
eq(zonedToUtc({ year: 2026, month: 3, day: 29 }, AMS).toISOString(), '2026-03-28T23:00:00.000Z', 'midnight on the spring-forward day resolves in the pre-transition offset');

// startOfMonthInTz — the budget window anchor. In Amsterdam the month starts an hour or two BEFORE
// midnight UTC, so spend recorded in that gap belongs to the new month, not the old one.
eq(startOfMonthInTz(AMS, new Date('2026-07-20T12:00:00Z')).toISOString(), '2026-06-30T22:00:00.000Z', 'the July budget month starts on 30 June 22:00Z');
eq(startOfDayInTz(AMS, new Date('2026-07-20T12:00:00Z')).toISOString(), '2026-07-19T22:00:00.000Z', 'the Amsterdam day starts at 22:00Z the evening before');

// parseDayInTz — what an <input type="date"> emits must land on the workspace's midnight, not UTC's.
eq(parseDayInTz('2026-07-15', AMS)?.toISOString(), '2026-07-14T22:00:00.000Z', 'a bare YYYY-MM-DD is the workspace midnight');
eq(parseDayInTz('2026-07-15T09:30:00Z', AMS)?.toISOString(), '2026-07-15T09:30:00.000Z', 'a full ISO instant carries its own offset and passes through');
eq(parseDayInTz('not a date', AMS), undefined, 'garbage parses to undefined rather than an Invalid Date');

// calendarDaysBetween — whole CALENDAR days, not rolling 24h blocks: 23:00 today → 01:00 tomorrow is
// one day left, even though only two hours passed. This is what "days left in the sprint" has to mean.
eq(calendarDaysBetween(new Date('2026-07-15T21:00:00Z'), new Date('2026-07-15T23:00:00Z'), AMS), 1, 'crossing the workspace midnight is one calendar day');
eq(calendarDaysBetween(new Date('2026-07-15T06:00:00Z'), new Date('2026-07-15T20:00:00Z'), AMS), 0, 'fourteen hours inside the same workspace day is zero');

// isUsableTimeZone — the write-side guard. Refusing a bad zone is what keeps the read side honest.
eq(isUsableTimeZone(AMS), true, 'a real IANA zone is usable');
eq(isUsableTimeZone('Mars/Olympus_Mons'), false, 'an invented zone is refused');
eq(isUsableTimeZone(''), false, 'an empty zone is refused');
// …and every READ fails closed to UTC instead of throwing, so a legacy bad row degrades quietly.
eq(dayKeyInTz(lateUtc, 'Mars/Olympus_Mons'), '2026-03-10', 'an unusable zone reads as UTC rather than throwing');

// computeAnalytics — the weekly buckets end at the workspace's own midnight. A ticket finished at
// 22:30Z on the 14th is already the 15th in Amsterdam, so it belongs to the CURRENT week, not last week.
const nowMs = new Date('2026-07-15T10:00:00Z').getTime();
const emptyUsage = { totalTokens: 0, byTicket: [], byDay: [], byPerson: [], byAi: [] };
const analytics = computeAnalytics(
  [{ key: 'DEV-1', status: 'done', archived: false, labels: [], createdAt: new Date('2026-07-10T09:00:00Z'), updatedAt: new Date('2026-07-14T22:30:00Z') }],
  emptyUsage, nowMs, AMS,
);
eq(analytics.throughputByWeek.length, 4, 'four weekly buckets');
eq(analytics.throughputByWeek[3]?.done, 1, 'a ticket done after the workspace midnight lands in the newest week');
eq(analytics.throughputByWeek[3]?.weekStart, '2026-07-09', 'the newest bucket starts six workspace days back');

report('dateTz');
