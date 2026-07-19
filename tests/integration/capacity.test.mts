//? Integration test for the CapacityManager (#12) against the REAL Redis. Verifies the
//? ATOMIC admission control that replaced the racy soft-cap: a hard cap on concurrent turns,
//? the `urgent` hotfix/security force-through (bypasses the cap), the deduped FIFO defer
//? queue, slot release freeing capacity, and staleness-eviction (crash-leaked slots self-heal).
//?
//? Env is set BEFORE importing the module (it reads WS_MAX_CONCURRENT_TURNS / WS_TURN_MAX_MS at
//? load). The capacity keys are host-wide, so we start from a clean slate and clean up after —
//? safe on the test Redis (runtime state the backend rebuilds), and members are test-prefixed.

process.env.WS_MAX_CONCURRENT_TURNS = '2';
process.env.WS_CAPACITY_LEASE_MS = '60000'; // 1 min renewable owner lease
process.env.WS_TURN_MAX_MS = '900000'; // independent 15 min hard watchdog policy

import { db, assert, eq, report } from '../_helpers.mts';
import { redis, tryCatch } from '@luckystack/core';
import { runInTenant } from '../../server/tenant/tenantContext';

//? Resolve secret-manager pointers (REDIS_PASSWORD_V1 → the real password) before the first
//? redis command — same boot path the other integration tests use via `db()`.
await db();

const cap = await import('../../server/orchestrator/capacity');

const stamp = Date.now();
const K = (n: string): string => `CAPTEST-${String(stamp)}-${n}`;
const [activeKey, ownerKey, queueKey, queuedSetKey] = cap.capacityRedisKeys('key-probe', 'ticket-probe', 'token-probe');
const hashTag = (key: string): string | null => /\{([^{}]+)\}/.exec(key)?.[1] ?? null;

//? Clean slate (no real turns run in the test window; the backend rebuilds this state).
await redis.del(activeKey, ownerKey, queueKey, queuedSetKey);

try {
  const t0 = 1_000_000; // simulated acquire-time (we pass `now` explicitly, no wall-clock)
  const WS = 'capws'; // H5 — acquire/release are now workspace-tagged (fair-drain occupancy)
  eq(cap.capacitySlotTtlMs(), 60_000, 'capacity uses WS_CAPACITY_LEASE_MS, not WS_TURN_MAX_MS');

  const acquire = async (key: string, workspaceId: string, force: boolean, now: number) => {
    const result = await cap.acquireSlot(key, workspaceId, force, now);
    assert(result.acquired, `${key} acquires a reservation`);
    if (!result.acquired) throw new Error('capacity fixture failed');
    return result.reservation;
  };

  //? Leading-colon namespace bypasses tenant formatting and every Lua key hashes to
  //? the exact same Redis Cluster slot. Two tenant ALS scopes still share one host cap.
  const tenantKeysA = await runInTenant('capacity-workspace-a', async () => cap.capacityRedisKeys('capacity-workspace-a', K('HOST-A'), 'probe-a'));
  const tenantKeysB = await runInTenant('capacity-workspace-b', async () => cap.capacityRedisKeys('capacity-workspace-a', K('HOST-A'), 'probe-a'));
  eq(tenantKeysA, tenantKeysB, 'capacity keys are byte-identical inside two tenant scopes');
  assert(tenantKeysA.every((key) => hashTag(key) === 'capacity'), 'all capacity Lua keys share the {capacity} Redis Cluster hash tag');
  const hostA = await runInTenant('capacity-workspace-a', () => acquire(K('HOST-A'), 'capacity-workspace-a', false, t0));
  const hostB = await runInTenant('capacity-workspace-b', () => acquire(K('HOST-B'), 'capacity-workspace-b', false, t0));
  eq(await runInTenant('capacity-workspace-a', () => cap.acquireSlot(K('HOST-C'), 'capacity-workspace-a', false, t0)), { acquired: false, reason: 'full' }, 'two workspaces consume one shared host cap');
  await cap.releaseSlot(hostA);
  await cap.releaseSlot(hostB);
  await redis.del(activeKey, ownerKey);

  //? Two normal admissions fill the cap of 2.
  const reservationA = await acquire(K('A'), WS, false, t0);
  const reservationB = await acquire(K('B'), WS, false, t0);
  //? The third normal turn is REJECTED — the atomic cap holds (no TOCTOU past it).
  eq(await cap.acquireSlot(K('C'), WS, false, t0), { acquired: false, reason: 'full' }, 'a third normal turn is rejected at the hard cap');
  //? An urgent (hotfix/security) turn FORCE-PASSES the cap.
  const reservationU = await acquire(K('U'), WS, true, t0);
  eq(await cap.activeCount(t0), 3, 'occupancy counts the urgent slot too (A, B, U)');
  assert(reservationA.runToken !== reservationB.runToken && reservationB.runToken !== reservationU.runToken, 'every admission receives a unique owner token');

  //? Deferred FIFO queue is deduped.
  eq(await cap.enqueueDeferred({ workspaceId: 'ws1', key: K('C'), stageId: 'plan' }), true, 'rejected turn is newly queued');
  eq(await cap.enqueueDeferred({ workspaceId: 'ws1', key: K('C'), stageId: 'plan' }), false, 're-queuing the same workspace+ticket is deduped');
  eq(await cap.enqueueDeferred({ workspaceId: 'ws2', key: K('C'), stageId: 'test' }), true, 'the same ticket key in a second workspace has an independent queue identity');
  const popped = await cap.dequeueDeferred();
  eq({ workspaceId: popped?.workspaceId, key: popped?.key }, { workspaceId: 'ws1', key: K('C') }, 'dequeue returns the first parked workspace+ticket');
  const secondWorkspace = await cap.dequeueDeferred();
  eq({ workspaceId: secondWorkspace?.workspaceId, key: secondWorkspace?.key }, { workspaceId: 'ws2', key: K('C') }, 'dequeue preserves the same key from the second workspace');
  eq(await cap.dequeueDeferred(), null, 'the queue is now empty');
  //? After a dequeue the workspace-scoped dedupe member is cleared, so the same ticket can be queued again.
  eq(await cap.enqueueDeferred({ workspaceId: 'ws1', key: K('C'), stageId: 'plan' }), true, 're-queue works once dequeued');
  const directQueuedAdmission = await acquire(K('C'), 'ws1', true, t0 + 1);
  eq(await cap.queueLength(), 0, 'successful direct/urgent admission atomically removes its stale queued list item');
  eq(await redis.sismember(queuedSetKey, `ws1::${K('C')}`), 0, 'successful admission atomically removes the matching queued-set identity');
  await cap.releaseSlot(directQueuedAdmission);

  //? Queue SADD+RPUSH fails without a half-entry when key types are invalid.
  await redis.set(queueKey, 'wrong-type');
  eq(await cap.enqueueDeferred({ workspaceId: 'ws-fail', key: K('FAIL'), stageId: 'plan' }), false, 'queue script reports an injected wrong-type failure');
  eq(await redis.sismember(queuedSetKey, `ws-fail::${K('FAIL')}`), 0, 'failed queue script leaves no dedupe-set half-entry');
  eq(await cap.acquireSlot(K('QUEUE-FAIL'), 'ws-fail', true, t0), { acquired: false, reason: 'unavailable' }, 'admission fails closed when atomic stale-queue cleanup cannot run');
  eq(await redis.hget(ownerKey, `ws-fail::${K('QUEUE-FAIL')}`), null, 'failed admission leaves no half-written owner');
  await redis.del(queueKey);

  //? Two drainers racing two workspace-qualified items remove each item exactly once.
  await cap.enqueueDeferred({ workspaceId: 'race-ws-1', key: K('RACE'), stageId: 'plan' });
  await cap.enqueueDeferred({ workspaceId: 'race-ws-2', key: K('RACE'), stageId: 'test' });
  const raced = await Promise.all([cap.dequeueFairDeferred({}), cap.dequeueFairDeferred({})]);
  eq(new Set(raced.map((item) => `${item?.workspaceId ?? ''}::${item?.key ?? ''}`)).size, 2, 'concurrent fair drainers claim two distinct workspace-qualified queue items');
  eq(await cap.queueLength(), 0, 'atomic LREM+SREM leaves no raced list entries');
  eq(await redis.scard(queuedSetKey), 0, 'atomic LREM+SREM leaves no raced set entries');

  await cap.enqueueDeferred({ workspaceId: 'stale-ws', key: K('STALE'), stageId: 'plan' });
  await cap.enqueueDeferred({ workspaceId: 'valid-ws', key: K('VALID'), stageId: 'test' });
  const visited: string[] = [];
  const valid = await cap.dequeueDeferredUntil({}, async (item) => {
    visited.push(item.key);
    return item.key === K('VALID') ? { stageId: item.stageId } : null;
  });
  eq(visited, [K('STALE'), K('VALID')], 'drain skips a stale target and continues to the next item');
  eq(valid?.item.key, K('VALID'), 'drain returns the first valid successor');
  eq(await cap.queueLength(), 0, 'stale and valid drain entries are both atomically removed');

  //? Releasing a slot frees capacity — but the urgent slot still occupies one.
  eq(await cap.releaseSlot(reservationA), true, 'the exact A owner releases its reservation');
  eq(await cap.activeCount(t0), 2, 'releasing A drops occupancy to 2 (B, U)');
  eq(await cap.acquireSlot(K('E'), WS, false, t0), { acquired: false, reason: 'full' }, 'still at cap (urgent occupies a real slot) — E rejected');
  eq(await cap.releaseSlot(reservationU), true, 'the exact urgent owner releases its reservation');
  await acquire(K('E'), WS, false, t0);

  //? A second launch for the SAME workspace+ticket is rejected before cap/force evaluation.
  await redis.del(activeKey, ownerKey);
  const duplicateOwner = await acquire(K('DUP'), WS, false, t0);
  eq(await cap.acquireSlot(K('DUP'), WS, false, t0 + 1), { acquired: false, reason: 'duplicate' }, 'a concurrent same-ticket launch is rejected as duplicate');
  eq(await cap.acquireSlot(K('DUP'), WS, true, t0 + 2), { acquired: false, reason: 'duplicate' }, 'urgent force-through cannot duplicate an already-running ticket');
  eq(await cap.activeCountReadOnly(t0 + 60_000), 0, 'the read-model counter excludes an expired slot');
  eq(await redis.zcard(activeKey), 1, 'the read-model counter does not evict the expired sorted-set member');
  eq(await redis.hlen(ownerKey), 1, 'the read-model counter does not rewrite owner state');
  eq(await cap.activeCount(t0 + 2), 1, 'the rejected duplicate does not add or release the first launch slot');

  //? Redis uncertainty is fail-closed: without shared admission truth no turn launches.
  eq(
    await cap.acquireSlot(K('REDIS-DOWN'), WS, false, t0, async () => { throw new Error('injected redis failure'); }),
    { acquired: false, reason: 'unavailable' },
    'a Redis error rejects admission instead of failing open',
  );
  eq(await cap.activeCount(t0 + 2), 1, 'the Redis-error path leaves the existing slot untouched');
  const [strictOwnerError] = await tryCatch(() => cap.reservationOwnsSlotStrict(
    WS,
    K('DUP'),
    duplicateOwner.runToken,
    duplicateOwner.fence,
    t0 + 2,
    async () => { throw new Error('injected owner uncertainty'); },
  ));
  assert(strictOwnerError !== null, 'strict owner probe throws on Redis uncertainty instead of returning not-owned');
  const [strictReleaseError] = await tryCatch(() => cap.releaseSlotStrict(
    duplicateOwner,
    async () => { throw new Error('injected release uncertainty'); },
  ));
  assert(strictReleaseError !== null, 'strict release throws on Redis uncertainty instead of returning not-owned');
  eq(await cap.reservationOwnsSlot(WS, K('DUP'), duplicateOwner.runToken, duplicateOwner.fence, t0 + 2), true, 'strict probe/release errors leave the exact owner intact');

  //? A healthy renewable owner cannot be stolen by boot recovery.
  await redis.del(activeKey, ownerKey);
  const healthyOwner = await acquire(K('HEALTHY'), WS, false, t0);
  const healthyRecovery = await cap.prepareRecoveryReservation({
    workspaceId: WS,
    ticketKey: K('HEALTHY'),
    oldRunToken: healthyOwner.runToken,
    oldRunFence: healthyOwner.fence,
    intentId: 'a'.repeat(24),
    allowLiveOwner: false,
    now: t0 + 1000,
  });
  eq(healthyRecovery, { prepared: false, reason: 'live' }, 'boot recovery cannot steal a healthy renewing owner');
  eq(await cap.reservationOwnsSlot(WS, K('HEALTHY'), healthyOwner.runToken, healthyOwner.fence, t0 + 1000), true, 'healthy owner remains stage authority');
  await cap.releaseSlot(healthyOwner);

  //? Expiry → recovery claim → successor. Recovery fences A immediately and blocks launch.
  await redis.del(activeKey, ownerKey);
  const expiredOwner = await acquire(K('S'), WS, false, t0);
  const preparedRecovery = await cap.prepareRecoveryReservation({
    workspaceId: WS,
    ticketKey: K('S'),
    oldRunToken: expiredOwner.runToken,
    oldRunFence: expiredOwner.fence,
    intentId: 'b'.repeat(24),
    allowLiveOwner: false,
    now: t0 + 60_000 + 1,
  });
  assert(preparedRecovery.prepared, 'an expired owner is atomically taken over by one recovery claim');
  if (!preparedRecovery.prepared) throw new Error('recovery fixture failed');
  assert(preparedRecovery.reservation.fence > expiredOwner.fence, 'recovery claim has a higher fence');
  eq(await cap.reservationOwnsSlot(WS, K('S'), expiredOwner.runToken, expiredOwner.fence, t0 + 60_000 + 1), false, 'prepare immediately fences old stage writes');
  eq(await cap.acquireSlot(K('S'), WS, false, t0 + 60_000 + 2), { acquired: false, reason: 'recovering' }, 'active recovery claim blocks a stage launch and is not mislabeled duplicate');
  eq(await cap.releaseSlot(expiredOwner), false, 'old release cannot remove the recovery owner');
  eq(await cap.releaseSlot(preparedRecovery.reservation), true, 'complete may release only its exact recovery owner');
  const successor = await acquire(K('S'), WS, false, t0 + 60_000 + 3);
  assert(expiredOwner.runToken !== successor.runToken, 'an expiry successor receives a distinct runToken');
  eq(await cap.reservationOwnsSlot(WS, K('S'), expiredOwner.runToken, expiredOwner.fence, t0 + 60_000 + 3), false, 'expired owner token+fence is no longer stage authority');
  eq(await cap.reservationOwnsSlot(WS, K('S'), successor.runToken, successor.fence, t0 + 60_000 + 3), true, 'successor token+fence is the current stage authority');
  assert(successor.fence > preparedRecovery.reservation.fence, 'the successor receives exactly one later admission fence');
  const staleRecovery = await cap.prepareRecoveryReservation({
    workspaceId: WS,
    ticketKey: K('S'),
    oldRunToken: expiredOwner.runToken,
    oldRunFence: expiredOwner.fence,
    intentId: 'c'.repeat(24),
    allowLiveOwner: true,
    now: t0 + 60_000 + 4,
  });
  eq(staleRecovery, { prepared: false, reason: 'stale' }, 'a stale scan of A cannot take over successor B');
  eq(await cap.releaseSlot(expiredOwner), false, 'the expired owner cannot release its successor reservation');
  eq(await cap.activeCount(t0 + 60_000 + 4), 1, 'the successor remains active after the old release');
  eq(await cap.releaseSlot(successor), true, 'the successor can release its own reservation');
  eq(await cap.activeCount(t0 + 60_000 + 4), 0, 'capacity is free only after successor release');
  eq(await cap.releaseSlot(duplicateOwner), false, 'an unrelated expired reservation cannot release a newer owner');

  //? Real-Redis renewal loop refreshes the heartbeat while the stage callback runs.
  await redis.del(activeKey, ownerKey);
  const renewable = await acquire(K('RENEW'), WS, false, Date.now());
  await cap.withReservationRenewal(renewable, async (guard) => {
    await new Promise((resolve) => setTimeout(resolve, 35));
    await guard.assertOwned();
  }, { renewEveryMs: 10 });
  eq(await cap.reservationOwnsSlot(WS, K('RENEW'), renewable.runToken, renewable.fence), true, 'renewed token+fence remains the live owner after multiple renewal ticks');
  await cap.releaseSlot(renewable);
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  await redis.del(activeKey, ownerKey, queueKey, queuedSetKey).catch(() => undefined);
}

report('tests/integration/capacity.test.mts');
