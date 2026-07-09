//? Integration test for the CapacityManager (#12) against the REAL Redis. Verifies the
//? ATOMIC admission control that replaced the racy soft-cap: a hard cap on concurrent turns,
//? the `urgent` hotfix/security force-through (bypasses the cap), the deduped FIFO defer
//? queue, slot release freeing capacity, and staleness-eviction (crash-leaked slots self-heal).
//?
//? Env is set BEFORE importing the module (it reads WS_MAX_CONCURRENT_TURNS / WS_TURN_MAX_MS at
//? load). The capacity keys are host-wide, so we start from a clean slate and clean up after —
//? safe on the test Redis (runtime state the backend rebuilds), and members are test-prefixed.

process.env.WS_MAX_CONCURRENT_TURNS = '2';
process.env.WS_TURN_MAX_MS = '60000'; // 1 min TTL for a clean staleness number

import { db, assert, eq, report } from '../_helpers.mts';
import { redis, formatKey } from '@luckystack/core';

//? Resolve secret-manager pointers (REDIS_PASSWORD_V1 → the real password) before the first
//? redis command — same boot path the other integration tests use via `db()`.
await db();

const cap = await import('../../server/orchestrator/capacity');

const stamp = Date.now();
const K = (n: string): string => `CAPTEST-${String(stamp)}-${n}`;
const activeKey = formatKey('capacity', 'active');
const queueKey = formatKey('capacity', 'queue');
const queuedSetKey = formatKey('capacity', 'queued');

//? Clean slate (no real turns run in the test window; the backend rebuilds this state).
await redis.del(activeKey, queueKey, queuedSetKey);

try {
  const t0 = 1_000_000; // simulated acquire-time (we pass `now` explicitly, no wall-clock)
  const WS = 'capws'; // H5 — acquire/release are now workspace-tagged (fair-drain occupancy)

  //? Two normal admissions fill the cap of 2.
  eq(await cap.acquireSlot(K('A'), WS, false, t0), true, 'first normal turn is admitted');
  eq(await cap.acquireSlot(K('B'), WS, false, t0), true, 'second normal turn is admitted (cap=2)');
  //? The third normal turn is REJECTED — the atomic cap holds (no TOCTOU past it).
  eq(await cap.acquireSlot(K('C'), WS, false, t0), false, 'a third normal turn is rejected at the hard cap');
  //? An urgent (hotfix/security) turn FORCE-PASSES the cap.
  eq(await cap.acquireSlot(K('U'), WS, true, t0), true, 'an urgent turn force-passes the cap');
  eq(await cap.activeCount(t0), 3, 'occupancy counts the urgent slot too (A, B, U)');

  //? Deferred FIFO queue is deduped.
  eq(await cap.enqueueDeferred({ workspaceId: 'ws1', key: K('C'), stageId: 'plan' }), true, 'rejected turn is newly queued');
  eq(await cap.enqueueDeferred({ workspaceId: 'ws1', key: K('C'), stageId: 'plan' }), false, 're-queuing the same ticket is deduped');
  const popped = await cap.dequeueDeferred();
  eq(popped?.key ?? '', K('C'), 'dequeue returns the parked turn (FIFO)');
  eq(await cap.dequeueDeferred(), null, 'the queue is now empty');
  //? After a dequeue the dedupe set is cleared, so the same ticket can be queued again.
  eq(await cap.enqueueDeferred({ workspaceId: 'ws1', key: K('C'), stageId: 'plan' }), true, 're-queue works once dequeued');

  //? Releasing a slot frees capacity — but the urgent slot still occupies one.
  await cap.releaseSlot(K('A'), WS);
  eq(await cap.activeCount(t0), 2, 'releasing A drops occupancy to 2 (B, U)');
  eq(await cap.acquireSlot(K('E'), WS, false, t0), false, 'still at cap (urgent occupies a real slot) — E rejected');
  await cap.releaseSlot(K('U'), WS);
  eq(await cap.acquireSlot(K('E'), WS, false, t0), true, 'after the urgent slot frees, E is admitted');

  //? Staleness eviction: a slot older than the TTL is reclaimed (a crashed instance self-heals).
  await redis.del(activeKey);
  eq(await cap.acquireSlot(K('S'), WS, false, t0), true, 'stale-test slot acquired at t0');
  eq(await cap.activeCount(t0), 1, 'the slot is counted before it ages out');
  eq(await cap.activeCount(t0 + 60000 + 1), 0, 'a slot older than the TTL is evicted (crash-leak self-heals)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  await redis.del(activeKey, queueKey, queuedSetKey).catch(() => undefined);
}

report('tests/integration/capacity.test.mts');
