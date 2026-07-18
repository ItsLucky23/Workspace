//? Multi-instance coordination verification (#15, Deel B). These tests exercise the Redis-backed
//? primitives under real concurrency (the same shared-Redis contention used by N instances). They
//? prove the listed lease/claim behavior, NOT cross-store DB fencing or a paused event loop (ADR 0277):
//?   1. withWorkspaceLease SERIALIZES concurrent writes on the SAME workspace (max concurrency 1)
//?   2. different workspaces do NOT block each other (per-workspace granularity, not a global lock)
//?   3. a >TTL action renews while a real-Redis contender stays excluded (short injectable timings)
//?   4. observed lease loss aborts/fails closed and owner-safe release preserves the successor
//?   5. claimActionOnce remains backwards-compatible for triggers
//?   6. control claims expose pending and replay TTL-bounded terminal success/failure
//?   7. the leader lease is EXCLUSIVE: a second acquire fails while held, succeeds after release
//? A live multi-process smoke test remains complementary; no test here makes Redis ownership and a
//? MongoDB mutation atomic.

import { db, assert, eq, report } from '../_helpers.mts';

await db(); //? initializes secrets + the Redis client the cluster primitives use
const cluster = await import('../../server/orchestrator/cluster');
const core = await import('@luckystack/core');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();

const [testError] = await core.tryCatch(async () => {
  // ---- 1. same-workspace lease serializes ----
  const wsA = `ws-mi-a-${String(stamp)}`;
  let active = 0; let maxActiveSame = 0;
  const criticalSection = async (): Promise<void> => {
    active += 1; maxActiveSame = Math.max(maxActiveSame, active);
    await sleep(60);
    active -= 1;
  };
  await Promise.all(Array.from({ length: 5 }, () => cluster.withWorkspaceLease(wsA, criticalSection)));
  eq(maxActiveSame, 1, 'withWorkspaceLease serialized 5 concurrent same-workspace writes (never 2 in the critical section at once)');

  // ---- 2. different workspaces run concurrently (per-workspace, not global) ----
  const wsB = `ws-mi-b-${String(stamp)}`;
  const wsC = `ws-mi-c-${String(stamp)}`;
  let activeDiff = 0; let maxActiveDiff = 0;
  const cs2 = async (): Promise<void> => { activeDiff += 1; maxActiveDiff = Math.max(maxActiveDiff, activeDiff); await sleep(80); activeDiff -= 1; };
  await Promise.all([cluster.withWorkspaceLease(wsB, cs2), cluster.withWorkspaceLease(wsC, cs2)]);
  eq(maxActiveDiff, 2, 'two DIFFERENT workspaces ran their critical sections concurrently (the lock is per-workspace, not global)');

  // ---- 3. renewable lease excludes a contender beyond the original TTL ----
  const shortTimings = { ttlMs: 120, renewEveryMs: 25, retryMs: 5, maxWaitMs: 700 };
  const renewableWs = `ws-mi-renew-${String(stamp)}`;
  const renewableLeaseName = core.formatKey('wslock', renewableWs);
  const renewableRedisKey = core.formatKey('lease', renewableLeaseName);
  let markFirstEntered: () => void = () => undefined;
  const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve; });
  let renewableActive = 0; let renewableMaxActive = 0;
  const renewableOrder: string[] = [];
  const firstHolder = cluster.withWorkspaceLease(renewableWs, async (guard) => {
    renewableActive += 1; renewableMaxActive = Math.max(renewableMaxActive, renewableActive);
    renewableOrder.push('first-enter'); markFirstEntered();
    await sleep(320);
    guard.assertHeld();
    renewableOrder.push('first-exit'); renewableActive -= 1;
  }, shortTimings);
  await firstEntered;
  await sleep(170); // beyond the original 120ms TTL; the first holder must still own it
  const renewedTtl = await core.redis.pttl(renewableRedisKey);
  assert(renewedTtl > 0 && renewedTtl <= shortTimings.ttlMs, 'the workspace lease still has a live bounded TTL after the original TTL elapsed');
  const secondHolder = cluster.withWorkspaceLease(renewableWs, async (guard) => {
    guard.assertHeld();
    renewableActive += 1; renewableMaxActive = Math.max(renewableMaxActive, renewableActive);
    renewableOrder.push('second-enter');
    await sleep(20);
    renewableOrder.push('second-exit'); renewableActive -= 1;
  }, shortTimings);
  await Promise.all([firstHolder, secondHolder]);
  eq(renewableMaxActive, 1, 'a real-Redis contender never overlaps a >TTL renewable workspace action');
  eq(renewableOrder, ['first-enter', 'first-exit', 'second-enter', 'second-exit'], 'the contender enters only after the renewable holder releases');

  // ---- 4. observed lease loss aborts/fails closed; release stays owner-safe ----
  const lossWs = `ws-mi-loss-${String(stamp)}`;
  const lossLeaseName = core.formatKey('wslock', lossWs);
  const lossRedisKey = core.formatKey('lease', lossLeaseName);
  let successorToken: string | null = null;
  let lossSignalAborted = false;
  const [leaseLossError] = await core.tryCatch(() => cluster.withWorkspaceLease(lossWs, async (guard) => {
    await core.redis.del(lossRedisKey);
    successorToken = await core.acquireLease(lossLeaseName, 1000);
    assert(successorToken !== null, 'a successor acquires after the original lease is deliberately removed');
    await sleep(70);
    lossSignalAborted = guard.signal.aborted;
  }, shortTimings));
  assert(
    leaseLossError instanceof cluster.WorkspaceLeaseLostError && leaseLossError.reason === 'renewal-failed',
    'an owner-checked renewal miss rejects the original caller with visible lease loss',
  );
  assert(lossSignalAborted, 'lease loss aborts the guard signal offered to the Conductor');
  eq(await core.redis.get(lossRedisKey), successorToken, 'the stale holder release cannot delete its successor lease');
  if (successorToken) await core.releaseLease(lossLeaseName, successorToken);

  // ---- 5. claimActionOnce dedup ----
  const dedupKey = `act-${String(stamp)}`;
  const claims = await Promise.all(Array.from({ length: 8 }, () => cluster.claimActionOnce(dedupKey)));
  eq(claims.filter(Boolean).length, 1, 'exactly ONE of 8 concurrent same-key claims won (cross-instance dedup)');
  const distinct = await Promise.all([0, 1, 2].map((i) => cluster.claimActionOnce(`act-distinct-${String(stamp)}-${String(i)}`)));
  eq(distinct.filter(Boolean).length, 3, 'three DISTINCT action keys all claimed (no false dedup)');

  // ---- 6. stateful control outcomes: pending + terminal replay + bounded TTL ----
  const successOutcomeKey = `control-success-${String(stamp)}`;
  const successClaim = await cluster.claimControlAction(successOutcomeKey);
  assert(successClaim.state === 'claimed', 'the first stateful control claim owns the pending record');
  const pendingDuplicate = await cluster.claimControlAction(successOutcomeKey);
  eq(pendingDuplicate, { state: 'pending' }, 'a duplicate sees pending instead of blind success');
  const pendingTtl = await core.redis.pttl(cluster.controlActionOutcomeKey(successOutcomeKey));
  assert(
    pendingTtl > 0 && pendingTtl <= cluster.CONTROL_ACTION_OUTCOME_TTL_MS,
    'the pending control outcome has a bounded TTL',
  );
  if (successClaim.state === 'claimed') {
    await cluster.completeControlAction(successOutcomeKey, successClaim.token, {
      state: 'success',
      signalSeq: 42,
      resultKeys: ['DEV-42', 'bad key', 'DEV-42', 'x'.repeat(cluster.MAX_CONTROL_ACTION_RESULT_KEY_BYTES + 1)],
    });
  }
  eq(
    await cluster.claimControlAction(successOutcomeKey),
    { state: 'success', signalSeq: 42, resultKeys: ['DEV-42'] },
    'terminal control success replays only bounded identifier-shaped result keys',
  );
  const successTtl = await core.redis.pttl(cluster.controlActionOutcomeKey(successOutcomeKey));
  assert(
    successTtl > 0 && successTtl <= cluster.CONTROL_ACTION_OUTCOME_TTL_MS,
    'the terminal success outcome has a bounded TTL',
  );

  const legacySuccessOutcomeKey = `control-legacy-success-${String(stamp)}`;
  await core.redis.set(
    cluster.controlActionOutcomeKey(legacySuccessOutcomeKey),
    'success:43',
    'PX',
    cluster.CONTROL_ACTION_OUTCOME_TTL_MS,
  );
  eq(
    await cluster.claimControlAction(legacySuccessOutcomeKey),
    { state: 'success', signalSeq: 43 },
    'a rolling-deploy legacy success:<seq> record still parses',
  );

  const failureOutcomeKey = `control-failure-${String(stamp)}`;
  const failureClaim = await cluster.claimControlAction(failureOutcomeKey);
  assert(failureClaim.state === 'claimed', 'a distinct control failure id can be claimed');
  if (failureClaim.state === 'claimed') {
    await cluster.completeControlAction(failureOutcomeKey, failureClaim.token, {
      state: 'failure', errorCode: 'control.executionFailure',
    });
  }
  eq(
    await cluster.claimControlAction(failureOutcomeKey),
    { state: 'failure', errorCode: 'control.executionFailure' },
    'terminal control failure is replayed across callers',
  );
  const failureTtl = await core.redis.pttl(cluster.controlActionOutcomeKey(failureOutcomeKey));
  assert(
    failureTtl > 0 && failureTtl <= cluster.CONTROL_ACTION_OUTCOME_TTL_MS,
    'the terminal failure outcome has a bounded TTL',
  );

  // ---- 7. leader lease is exclusive ----
  const leaderKey = core.formatKey('leader', `test-conductor-${String(stamp)}`);
  const first = await core.acquireLease(leaderKey, 15_000);
  assert(first !== null, 'the first instance acquires the leader lease');
  const second = await core.acquireLease(leaderKey, 15_000);
  eq(second, null, 'a second instance CANNOT acquire the leader lease while held (exactly one leader)');
  if (first) await core.releaseLease(leaderKey, first);
  const third = await core.acquireLease(leaderKey, 15_000);
  assert(third !== null, 'after the leader releases, another instance can take over (failover)');
  if (third) await core.releaseLease(leaderKey, third);
});
if (testError) assert(false, `unexpected error: ${testError.message}`);

report('tests/integration/multiInstance.test.mts');
