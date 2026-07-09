//? Y1 — the activity-presence status + aggregation (pure). Verifies the active/idle/away thresholds (incl. the
//? editing-forces-active rule) and the per-view aggregation (latest-per-user wins, away dropped, active count).

import { assert, eq, report } from '../_helpers.mts';
import { resolvePresenceStatus, aggregatePresence } from '../../server/ultrasync/presence.ts';

const now = 1_000_000_000_000;

// status thresholds
eq(resolvePresenceStatus(now - 30_000, now), 'active', '<60s → active');
eq(resolvePresenceStatus(now - 120_000, now), 'idle', '1-5min → idle');
eq(resolvePresenceStatus(now - 600_000, now), 'away', '>5min → away');
eq(resolvePresenceStatus(now - 600_000, now, true), 'active', 'a live edit forces active regardless of the clock');

// aggregation: per-view, latest-per-user, away dropped, active count
{
  const entries = [
    { userId: 'u1', view: 'pipeline', editing: true, lastMs: now - 600_000 },   // editing → active despite old ts
    { userId: 'u1', view: 'pipeline', editing: false, lastMs: now - 700_000 },  // older duplicate — ignored
    { userId: 'u2', view: 'pipeline', editing: false, lastMs: now - 120_000 },  // idle
    { userId: 'u3', view: 'pipeline', editing: false, lastMs: now - 900_000 },  // away → dropped
    { userId: 'u4', view: 'board', editing: false, lastMs: now - 10_000 },      // active, other view
  ];
  const agg = aggregatePresence(entries, now);
  const pipeline = agg.find((v) => v.view === 'pipeline');
  eq(pipeline?.users.length, 2, 'pipeline shows the 2 present users (away u3 dropped)');
  const u1 = pipeline?.users.find((u) => u.userId === 'u1');
  eq(u1?.status, 'active', 'u1 is active (editing) — the latest entry won');
  eq(u1?.editing, true, 'u1 is flagged editing');
  eq(pipeline?.users.find((u) => u.userId === 'u2')?.status, 'idle', 'u2 is idle');
  eq(pipeline?.activeCount, 1, 'one active user on pipeline (u1)');
  const board = agg.find((v) => v.view === 'board');
  eq(board?.activeCount, 1, 'the other view has its own active count');
}

eq(aggregatePresence([], now).length, 0, 'no entries → no views');

report('tests/unit/presence.test.mts');
