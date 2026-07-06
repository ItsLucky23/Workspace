//? Unit test for G1 (delivery analytics, ADR 0047). The fold is PURE — no DB needed. Hand-computes cycle
//? p50/p85, weekly throughput, stuck count, and tokens-by-label from seeded tickets + usage, and checks the
//? fold matches. Cost is asserted in TOKENS (invariant #9). Deterministic via an injected `now`.

import { assert, eq, report } from '../_helpers.mts';

const { computeAnalytics } = await import('../../server/obs/analytics');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = 1_700_000_000_000;
const twoDaysAgo = now - 2 * DAY;

//? 3 done tickets with cycles 2h / 10h / 4h (→ sorted 2,4,10), all shipped within the last week; 1 stuck open.
const tickets = [
  { key: 'DEV-1', status: 'done', archived: false, labels: ['bug'], createdAt: new Date(twoDaysAgo - 2 * HOUR), updatedAt: new Date(twoDaysAgo) },
  { key: 'DEV-2', status: 'done', archived: false, labels: ['feature'], createdAt: new Date(twoDaysAgo - 10 * HOUR), updatedAt: new Date(twoDaysAgo) },
  { key: 'DEV-3', status: 'done', archived: false, labels: ['bug'], createdAt: new Date(twoDaysAgo - 4 * HOUR), updatedAt: new Date(twoDaysAgo) },
  { key: 'DEV-4', status: 'stuck', archived: false, labels: [], createdAt: new Date(now - 5 * DAY), updatedAt: new Date(now - DAY) },
  { key: 'DEV-5', status: 'done', archived: true, labels: ['bug'], createdAt: new Date(twoDaysAgo - HOUR), updatedAt: new Date(twoDaysAgo) },  // archived → ignored
];
const usage = { byTicket: [{ ticketKey: 'DEV-1', tokensIn: 60, tokensOut: 40, turns: 1 }, { ticketKey: 'DEV-2', tokensIn: 100, tokensOut: 100, turns: 2 }, { ticketKey: 'DEV-3', tokensIn: 30, tokensOut: 20, turns: 1 }], activity: [], totalTokens: 350, totalTurns: 4 };

const a = computeAnalytics(tickets, usage, now);

eq(a.doneCount, 3, 'archived tickets are excluded; 3 done');
eq(a.openCount, 1, 'the stuck ticket counts as open');
eq(a.stuckCount, 1, 'the stuck ticket is counted as stuck');
eq(a.cycleP50Hours, 4, 'cycle p50 = the middle of [2,4,10] = 4h');
eq(a.cycleP85Hours, 10, 'cycle p85 = the top of [2,4,10] = 10h');
eq(a.throughputByWeek.length, 4, 'four weekly throughput buckets');
eq(a.throughputByWeek.at(-1)?.done, 3, 'all 3 shipped in the most recent week');
eq(a.throughputByWeek[0]?.done, 0, 'the oldest week has no throughput');
eq(a.tokensByLabel[0]?.label, 'feature', 'tokens-by-label is sorted by tokens desc (feature 200)');
eq(a.tokensByLabel[0]?.tokens, 200, 'feature total = DEV-2 (200)');
eq(a.tokensByLabel[1]?.label, 'bug', 'bug is second');
eq(a.tokensByLabel[1]?.tokens, 150, 'bug total = DEV-1 (100) + DEV-3 (50) = 150');
eq(a.totalTokens, 350, 'total tokens carried through (cost in TOKENS, invariant #9)');

//? Empty input → all zeros, no throw.
const empty = computeAnalytics([], { byTicket: [], activity: [], totalTokens: 0, totalTurns: 0 }, now);
eq(empty.cycleP85Hours, 0, 'empty input yields a zeroed fold');
assert(empty.tokensByLabel.length === 0, 'empty input yields no token buckets');

report('tests/integration/analytics.test.mts');
