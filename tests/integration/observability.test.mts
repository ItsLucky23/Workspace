//? Integration test for observability (#5): the structured logger line format, the insights
//? aggregate (cycle time / throughput / cost-per-ticket), the Prometheus renderer, and gatherMetrics
//? against the REAL capacity (Redis) + Mongo. The /healthz//readyz//metrics HTTP handlers are
//? verified by curl in the browser phase.

import { db, assert, eq, report } from '../_helpers.mts';

const { formatLogLine } = await import('../../server/obs/logger');
const { computeInsights } = await import('../../server/obs/insights');
const { renderPrometheus, gatherMetrics } = await import('../../server/obs/metrics');
await db(); // resolve secrets so gatherMetrics can reach Mongo/Redis

try {
  // ---- structured log line ----
  const line = formatLogLine('warn', 'turn deferred', { workspaceId: 'w1', ticketId: 'DEV-3', n: 4, skip: undefined }, '2026-07-03T10:00:00.000Z');
  const parsed = JSON.parse(line) as Record<string, unknown>;
  eq(parsed.ts, '2026-07-03T10:00:00.000Z', 'log line carries the ISO timestamp');
  eq(parsed.level, 'warn', 'log line carries the level');
  eq(parsed.msg, 'turn deferred', 'log line carries the message');
  eq(parsed.workspaceId, 'w1', 'log line carries context fields');
  eq(parsed.n, 4, 'numeric fields survive');
  eq('skip' in parsed, false, 'undefined fields are dropped');

  // ---- insights (pure) ----
  const now = Date.UTC(2026, 6, 3, 12, 0, 0);
  const HOUR = 3600_000; const DAY = 24 * HOUR;
  const tickets = [
    { status: 'done', archived: false, createdAt: new Date(now - 10 * HOUR), updatedAt: new Date(now - 8 * HOUR) },   // 2h cycle, done today
    { status: 'done', archived: false, createdAt: new Date(now - 20 * DAY), updatedAt: new Date(now - 19 * DAY) },     // 24h cycle, done >7d ago
    { status: 'busy', archived: false, createdAt: new Date(now - 5 * HOUR), updatedAt: new Date(now - 1 * HOUR) },     // open
    { status: 'done', archived: true, createdAt: new Date(now - 1 * DAY), updatedAt: new Date(now) },                  // archived → ignored
  ];
  const usage = { byTicket: [{ ticketKey: 'DEV-1', tokensIn: 100, tokensOut: 100, turns: 1 }, { ticketKey: 'DEV-2', tokensIn: 300, tokensOut: 100, turns: 2 }], activity: [], totalTokens: 600, totalTurns: 3 };
  const ins = computeInsights(tickets, usage, now);
  eq(ins.doneCount, 2, 'two done tickets (archived excluded)');
  eq(ins.openCount, 1, 'one open ticket');
  eq(ins.avgCycleHours, 13, 'avg cycle = mean(2h, 24h) = 13h');
  eq(ins.throughput7d, 1, 'only the recently-done ticket counts toward 7-day throughput');
  eq(ins.avgTokensPerTicket, 300, 'cost per ticket = 600 tokens / 2 tickets-with-usage');

  // ---- prometheus render ----
  const text = renderPrometheus({ activeTurns: 2, queuedTurns: 1, capacityLimit: 4, busyWorkerSessions: 2, residentContainers: 0, isLeader: 1 });
  assert(text.includes('workspaces_active_turns 2'), 'prometheus text exposes the active-turns gauge');
  assert(text.includes('# TYPE workspaces_is_leader gauge'), 'prometheus text has TYPE lines');
  assert(text.includes('workspaces_capacity_limit 4'), 'prometheus text exposes the cap');

  // ---- gatherMetrics (real Redis + Mongo) ----
  const m = await gatherMetrics(Date.now());
  assert(typeof m.activeTurns === 'number' && m.activeTurns >= 0, 'gatherMetrics reads active turns from Redis');
  assert(typeof m.busyWorkerSessions === 'number' && m.busyWorkerSessions >= 0, 'gatherMetrics counts busy sessions from Mongo');
  assert(m.capacityLimit > 0, 'gatherMetrics reports the capacity limit');
  assert(m.isLeader === 0 || m.isLeader === 1, 'gatherMetrics reports leader state as 0/1');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
}

report('tests/integration/observability.test.mts');
