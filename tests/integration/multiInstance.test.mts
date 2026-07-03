//? Multi-instance coordination verification (#15, Deel B). The Deel-A primitives (cluster.ts) are
//? Redis-backed atomics, so exercising them under CONCURRENCY against the real Redis proves exactly
//? what N separate instances would do (they share the same Redis the same way). Proven here:
//?   1. withWorkspaceLease SERIALIZES concurrent writes on the SAME workspace (max concurrency 1)
//?   2. different workspaces do NOT block each other (per-workspace granularity, not a global lock)
//?   3. claimActionOnce dedups: N concurrent same-key claims → exactly ONE winner; distinct keys all win
//?   4. the leader lease is EXCLUSIVE: a second acquire fails while held, succeeds after release
//? The remaining step — booting N OS processes — is a smoke test that needs the operator's go-ahead
//? (it disrupts the single-backend dev setup); the coordination logic itself is fully proven here.

import { db, assert, eq, report } from '../_helpers.mts';

await db(); //? initializes secrets + the Redis client the cluster primitives use
const cluster = await import('../../server/orchestrator/cluster');
const core = await import('@luckystack/core');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();

try {
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

  // ---- 3. claimActionOnce dedup ----
  const dedupKey = `act-${String(stamp)}`;
  const claims = await Promise.all(Array.from({ length: 8 }, () => cluster.claimActionOnce(dedupKey)));
  eq(claims.filter(Boolean).length, 1, 'exactly ONE of 8 concurrent same-key claims won (cross-instance dedup)');
  const distinct = await Promise.all([0, 1, 2].map((i) => cluster.claimActionOnce(`act-distinct-${String(stamp)}-${String(i)}`)));
  eq(distinct.filter(Boolean).length, 3, 'three DISTINCT action keys all claimed (no false dedup)');

  // ---- 4. leader lease is exclusive ----
  const leaderKey = core.formatKey('leader', `test-conductor-${String(stamp)}`);
  const first = await core.acquireLease(leaderKey, 15_000);
  assert(first !== null, 'the first instance acquires the leader lease');
  const second = await core.acquireLease(leaderKey, 15_000);
  eq(second, null, 'a second instance CANNOT acquire the leader lease while held (exactly one leader)');
  if (first) await core.releaseLease(leaderKey, first);
  const third = await core.acquireLease(leaderKey, 15_000);
  assert(third !== null, 'after the leader releases, another instance can take over (failover)');
  if (third) await core.releaseLease(leaderKey, third);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/integration/multiInstance.test.mts');
