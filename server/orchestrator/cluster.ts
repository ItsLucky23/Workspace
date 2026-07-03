//? Multi-instance coordination (Fase 2, Deel A). Makes the engine SAFE to run as N instances
//? behind the router while still running as one today — spinning up more instances is then config,
//? not a rewrite. Three Redis-backed primitives (Redis is already a hard dep: session/seq/rate-limit):
//?
//?  - Leader election (`isLeader`) — a single renewable lease; only the leader runs the per-process
//?    background loops (GitLab poller, editor reaper) so N instances don't duplicate that work.
//?  - Per-workspace mutual exclusion (`withWorkspaceLease`) — serialises the authoritative write for
//?    a workspace ACROSS instances, the cross-instance half of the conductor's single-writer.
//?  - Cross-instance action dedup (`claimActionOnce`) — an idempotency marker that survives across
//?    instances (replaces the in-process Set, which also leaked unboundedly).
//?
//? Single-instance cost is negligible (uncontended lease = one SET/DEL per user-initiated action);
//? every path is always exercised, so there is no "untested when you scale" cliff. Cross-instance
//? realtime fan-out is the one piece gated behind WS_MULTI_INSTANCE (see server.ts) since it adds
//? pub/sub overhead only a real N-instance deploy needs.

import { acquireLease, renewLease, releaseLease, formatKey, tryCatch } from '@luckystack/core';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

//? ───────── Leader election ─────────
const LEADER_TTL_MS = 15_000;
const LEADER_RENEW_MS = 5000;
let leaderToken: string | null = null;
let leaderTimer: ReturnType<typeof setInterval> | null = null;

const leaderKey = (): string => formatKey('leader', 'conductor');

//? True on the one instance that currently holds the leadership lease. Background loops gate on this.
export function isLeader(): boolean {
  return leaderToken !== null;
}

//? Renew the lease while held, otherwise try to claim it. A lost renew (expired / transient Redis
//? error) drops leadership so the next tick re-claims — the TTL bounds any gap.
async function leaderTick(): Promise<void> {
  if (leaderToken !== null) {
    const held = await renewLease(leaderKey(), leaderToken, LEADER_TTL_MS);
    if (!held) { leaderToken = null; console.log('[cluster] lost leadership'); }
    return;
  }
  const token = await acquireLease(leaderKey(), LEADER_TTL_MS);
  if (token !== null) { leaderToken = token; console.log('[cluster] acquired leadership'); }
}

//? Start maintaining the leadership lease. Idempotent.
export function startLeaderElection(): void {
  if (leaderTimer) return;
  void tryCatch(leaderTick);
  leaderTimer = setInterval(() => { void tryCatch(leaderTick); }, LEADER_RENEW_MS);
}

//? ───────── Per-workspace mutual exclusion ─────────
const WS_LOCK_TTL_MS = 15_000;
const WS_LOCK_RETRY_MS = 40;
const WS_LOCK_MAX_WAIT_MS = 8000;

const wsLockKey = (workspaceId: string): string => formatKey('wslock', workspaceId);

//? Run `fn` while holding the workspace's cross-instance lease, so no two instances perform a
//? concurrent authoritative write on the same workspace. Uncontended (single instance) this is an
//? instant SET + DEL. Contended it retries briefly; if the holder never releases the TTL frees it.
//? Throws on wait-timeout (fail the write rather than race it). `fn` must stay quick (AI turns run
//? OFF this path); the TTL must exceed the critical section.
export async function withWorkspaceLease<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  const key = wsLockKey(workspaceId);
  let token: string | null = null;
  for (let waited = 0; waited < WS_LOCK_MAX_WAIT_MS; waited += WS_LOCK_RETRY_MS) {
    token = await acquireLease(key, WS_LOCK_TTL_MS);
    if (token !== null) break;
    await sleep(WS_LOCK_RETRY_MS);
  }
  if (token === null) throw new Error(`[cluster] workspace-lease timeout for ${workspaceId}`);
  try {
    return await fn();
  } finally {
    await releaseLease(key, token);
  }
}

//? ───────── Cross-instance action dedup ─────────
const DEDUP_TTL_MS = 60_000;

//? Claim an action's idempotency key exactly once across all instances: returns true for the first
//? caller, false for a duplicate re-send (within the TTL window — re-sends happen within seconds).
export async function claimActionOnce(dedupKey: string): Promise<boolean> {
  const token = await acquireLease(formatKey('ctldedup', dedupKey), DEDUP_TTL_MS);
  return token !== null;
}
