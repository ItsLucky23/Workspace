//? Multi-instance coordination (Fase 2, Deel A). Makes the engine SAFE to run as N instances
//? behind the router while still running as one today — spinning up more instances is then config,
//? not a rewrite. Three Redis-backed primitives (Redis is already a hard dep: session/seq/rate-limit):
//?
//?  - Leader election (`isLeader`) — a single renewable lease; only the leader runs the per-process
//?    background loops (GitLab poller, editor reaper) so N instances don't duplicate that work.
//?  - Per-workspace mutual exclusion (`withWorkspaceLease`) — renewably excludes contenders around
//?    a workspace write across instances. It is NOT cross-store database fencing (ADR 0277).
//?  - Cross-instance action dedup — `claimActionOnce` keeps the original boolean trigger contract;
//?    control ACKs use a stateful claim that replays terminal success/failure across instances.
//?
//? Single-instance cost is negligible (uncontended lease = one SET/DEL per user-initiated action);
//? every path is always exercised, so there is no "untested when you scale" cliff. Cross-instance
//? realtime fan-out is the one piece gated behind WS_MULTI_INSTANCE (see server.ts) since it adds
//? pub/sub overhead only a real N-instance deploy needs.

import { randomBytes } from 'node:crypto';

import { acquireLease, renewLease, releaseLease, formatKey, redis, tryCatch } from '@luckystack/core';

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
export interface WorkspaceLeaseTimings {
  ttlMs: number;
  renewEveryMs: number;
  retryMs: number;
  maxWaitMs: number;
}

export const DEFAULT_WORKSPACE_LEASE_TIMINGS: WorkspaceLeaseTimings = {
  ttlMs: 15_000,
  renewEveryMs: 5000,
  retryMs: 40,
  maxWaitMs: 8000,
};

export type WorkspaceLeaseLossReason = 'renewal-failed' | 'renewal-deadline' | 'release-not-owner';

export class WorkspaceLeaseLostError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly reason: WorkspaceLeaseLossReason,
  ) {
    super(`[cluster] workspace lease lost for ${workspaceId} (${reason})`);
    this.name = 'WorkspaceLeaseLostError';
  }
}

//? The Conductor checks this guard at every irreversible boundary. `signal` lets future cancellable
//? providers stop early too; `assertHeld` is still mandatory because most DB calls are not abortable.
export interface WorkspaceLeaseGuard {
  readonly signal: AbortSignal;
  assertHeld(): void;
}

const wsLockKey = (workspaceId: string): string => formatKey('wslock', workspaceId);

function validateWorkspaceLeaseTimings(timings: Readonly<WorkspaceLeaseTimings>): void {
  const values = [timings.ttlMs, timings.renewEveryMs, timings.retryMs, timings.maxWaitMs];
  if (values.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error('[cluster] workspace-lease timings must be positive safe integers');
  }
  if (timings.renewEveryMs > Math.floor(timings.ttlMs / 2)) {
    throw new Error('[cluster] workspace-lease renewal must run by half of the TTL');
  }
}

//? Resolve true when the timer elapsed, false when lease maintenance was stopped. This makes normal
//? completion wake the renewal loop immediately instead of waiting for the next renewal interval.
function waitForLeaseTick(ms: number, stopSignal: AbortSignal): Promise<boolean> {
  if (stopSignal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (elapsed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopSignal.removeEventListener('abort', onAbort);
      resolve(elapsed);
    };
    const timer = setTimeout(() => { finish(true); }, ms);
    const onAbort = (): void => { finish(false); };
    stopSignal.addEventListener('abort', onAbort, { once: true });
  });
}

type WorkspaceLeaseRenewalResult =
  | { state: 'renewed'; held: boolean }
  | { state: 'deadline' };

//? Race one owner-checked renew against the last locally-known expiry. A Redis command that stalls
//? past that deadline is treated as lease loss even if its eventual response would be ambiguous.
async function renewWorkspaceLeaseBefore(
  key: string,
  token: string,
  ttlMs: number,
  deadlineAt: number,
): Promise<WorkspaceLeaseRenewalResult> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return { state: 'deadline' };

  const renewal = tryCatch(() => renewLease(key, token, ttlMs));
  const deadlineStop = new AbortController();
  const deadline = waitForLeaseTick(remainingMs, deadlineStop.signal)
    .then(() => ({ state: 'deadline' as const }));
  const outcome = await Promise.race([
    renewal.then(([error, held]) => ({ state: 'renewed' as const, held: error === null && held === true })),
    deadline,
  ]);
  deadlineStop.abort();
  return outcome;
}

async function maintainWorkspaceLease(
  key: string,
  token: string,
  timings: Readonly<WorkspaceLeaseTimings>,
  stopSignal: AbortSignal,
  markLost: (reason: WorkspaceLeaseLossReason) => void,
): Promise<void> {
  let deadlineAt = Date.now() + timings.ttlMs;
  while (!stopSignal.aborted) {
    const elapsed = await waitForLeaseTick(timings.renewEveryMs, stopSignal);
    if (!elapsed) return;
    if (Date.now() >= deadlineAt) {
      markLost('renewal-deadline');
      return;
    }

    //? The loop awaits each owner-checked renewal before it can schedule another: renewals never overlap.
    const renewalStartedAt = Date.now();
    const renewal = await renewWorkspaceLeaseBefore(key, token, timings.ttlMs, deadlineAt);
    if (renewal.state === 'deadline') {
      markLost('renewal-deadline');
      return;
    }
    if (!renewal.held) {
      markLost('renewal-failed');
      return;
    }
    //? Conservative local deadline: Redis cannot have processed the renewal before we started it.
    deadlineAt = renewalStartedAt + timings.ttlMs;
  }
}

interface WorkspaceLeaseState {
  loss: WorkspaceLeaseLostError | null;
}

function currentWorkspaceLeaseLoss(state: Readonly<WorkspaceLeaseState>): WorkspaceLeaseLostError | null {
  return state.loss;
}

//? Run `fn` under a renewable, owner-checked workspace lease. A renewal loss aborts the guard and
//? makes the caller fail closed; owner-checked release can never delete a successor's lease. The
//? injectable timings keep real-Redis expiry/contender tests sub-second while production stays 15s.
export async function withWorkspaceLease<T>(
  workspaceId: string,
  fn: (guard: WorkspaceLeaseGuard) => Promise<T>,
  timings: Readonly<WorkspaceLeaseTimings> = DEFAULT_WORKSPACE_LEASE_TIMINGS,
): Promise<T> {
  validateWorkspaceLeaseTimings(timings);
  const key = wsLockKey(workspaceId);
  const waitStartedAt = Date.now();
  let token: string | null = null;
  for (;;) {
    token = await acquireLease(key, timings.ttlMs);
    if (token !== null) break;
    const remainingMs = timings.maxWaitMs - (Date.now() - waitStartedAt);
    if (remainingMs <= 0) break;
    await sleep(Math.min(timings.retryMs, remainingMs));
  }
  if (token === null) throw new Error(`[cluster] workspace-lease timeout for ${workspaceId}`);

  const leaseAbort = new AbortController();
  const maintenanceStop = new AbortController();
  const leaseState: WorkspaceLeaseState = { loss: null };
  const markLost = (reason: WorkspaceLeaseLossReason): void => {
    if (currentWorkspaceLeaseLoss(leaseState) !== null) return;
    const loss = new WorkspaceLeaseLostError(workspaceId, reason);
    leaseState.loss = loss;
    leaseAbort.abort(loss);
  };
  const guard: WorkspaceLeaseGuard = {
    signal: leaseAbort.signal,
    assertHeld: (): void => {
      const loss = currentWorkspaceLeaseLoss(leaseState);
      if (loss !== null) throw loss;
    },
  };
  const maintenance = maintainWorkspaceLease(key, token, timings, maintenanceStop.signal, markLost);

  let actionError: Error | null = null;
  let actionOutcome: { value: T } | null = null;
  try {
    [actionError, actionOutcome] = await tryCatch(async () => {
      const value = await fn(guard);
      guard.assertHeld();
      return { value };
    });
  } finally {
    maintenanceStop.abort();
    const [maintenanceError] = await tryCatch(() => maintenance);
    if (maintenanceError) markLost('renewal-failed');
    const [releaseError, released] = await tryCatch(() => releaseLease(key, token));
    if (releaseError || released !== true) markLost('release-not-owner');
  }

  const leaseLoss = currentWorkspaceLeaseLoss(leaseState);
  if (leaseLoss !== null) throw leaseLoss;
  if (actionError !== null) throw actionError;
  if (actionOutcome === null) throw new Error('[cluster] workspace-lease action returned no outcome');
  return actionOutcome.value;
}

//? ───────── Cross-instance action dedup ─────────
const DEDUP_TTL_MS = 60_000;

//? Claim an action's idempotency key exactly once across all instances: returns true for the first
//? caller, false for a duplicate re-send (within the TTL window — re-sends happen within seconds).
export async function claimActionOnce(dedupKey: string): Promise<boolean> {
  const token = await acquireLease(formatKey('ctldedup', dedupKey), DEDUP_TTL_MS);
  return token !== null;
}

//? Control ACK idempotency needs more than the boolean trigger contract above: a duplicate must
//? distinguish pending from terminal success/failure. Only the outcome code + signal seq are stored
//? (never an Error message or arbitrary op result), and both pending + terminal records are TTL-bounded.
export const CONTROL_ACTION_OUTCOME_TTL_MS = 60_000;
const CONTROL_ACTION_PENDING_WAIT_MS = 2000;
const CONTROL_ACTION_PENDING_POLL_MS = 20;

export type ControlActionFailureCode = 'control.semanticFailure' | 'control.executionFailure';
export type ControlActionTerminalOutcome =
  | { state: 'success'; signalSeq: number }
  | { state: 'failure'; errorCode: ControlActionFailureCode };
export type ControlActionClaim =
  | { state: 'claimed'; token: string }
  | { state: 'pending' }
  | ControlActionTerminalOutcome;

type StoredControlActionOutcome =
  | { state: 'pending'; token: string }
  | ControlActionTerminalOutcome;

export const controlActionOutcomeKey = (dedupKey: string): string => formatKey('ctloutcome', dedupKey);

const CLAIM_CONTROL_ACTION_LUA = `
local current = redis.call('GET', KEYS[1])
if current then return current end
local written = redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')
if written then return ARGV[1] end
return redis.call('GET', KEYS[1])
`;

const COMPLETE_CONTROL_ACTION_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0
`;

function parseControlActionOutcome(raw: string): StoredControlActionOutcome {
  if (raw.startsWith('pending:')) {
    const token = raw.slice('pending:'.length);
    if (token.length > 0) return { state: 'pending', token };
  }
  if (raw.startsWith('success:')) {
    const signalSeq = Number(raw.slice('success:'.length));
    if (Number.isSafeInteger(signalSeq)) return { state: 'success', signalSeq };
  }
  if (raw === 'failure:control.semanticFailure') {
    return { state: 'failure', errorCode: 'control.semanticFailure' };
  }
  if (raw === 'failure:control.executionFailure') {
    return { state: 'failure', errorCode: 'control.executionFailure' };
  }
  throw new Error('[cluster] invalid control-action outcome record');
}

async function readControlActionOutcome(dedupKey: string): Promise<StoredControlActionOutcome | null> {
  const [error, raw] = await tryCatch(() => redis.get(controlActionOutcomeKey(dedupKey)));
  if (error) throw error;
  return typeof raw === 'string' ? parseControlActionOutcome(raw) : null;
}

//? Atomically create a pending claim or read the already-shared outcome. Comparing the opaque token
//? tells the one winner apart from concurrent callers that received the same pending record.
export async function claimControlAction(dedupKey: string): Promise<ControlActionClaim> {
  const token = randomBytes(16).toString('hex');
  const pending = `pending:${token}`;
  const [error, raw] = await tryCatch(() => redis.eval(
    CLAIM_CONTROL_ACTION_LUA,
    1,
    controlActionOutcomeKey(dedupKey),
    pending,
    String(CONTROL_ACTION_OUTCOME_TTL_MS),
  ));
  if (error) throw error;
  if (typeof raw !== 'string') throw new Error('[cluster] control-action claim returned no outcome');
  const outcome = parseControlActionOutcome(raw);
  if (outcome.state === 'pending') {
    return outcome.token === token ? { state: 'claimed', token } : { state: 'pending' };
  }
  return outcome;
}

//? Owner-checked terminal transition: an expired/stale claimant can never overwrite a newer owner.
export async function completeControlAction(
  dedupKey: string,
  token: string,
  outcome: ControlActionTerminalOutcome,
): Promise<void> {
  const terminal = outcome.state === 'success'
    ? `success:${String(outcome.signalSeq)}`
    : `failure:${outcome.errorCode}`;
  const [error, completed] = await tryCatch(() => redis.eval(
    COMPLETE_CONTROL_ACTION_LUA,
    1,
    controlActionOutcomeKey(dedupKey),
    `pending:${token}`,
    terminal,
    String(CONTROL_ACTION_OUTCOME_TTL_MS),
  ));
  if (error) throw error;
  if (completed !== 1) throw new Error('[cluster] control-action claim ownership was lost');
}

//? A concurrent duplicate waits briefly for the owner's terminal outcome. Timing out remains an
//? explicit pending state — never a blind success — and a later retry can replay the terminal record.
export async function waitForControlActionOutcome(
  dedupKey: string,
): Promise<ControlActionTerminalOutcome | { state: 'pending' }> {
  for (let waited = 0; waited <= CONTROL_ACTION_PENDING_WAIT_MS; waited += CONTROL_ACTION_PENDING_POLL_MS) {
    const outcome = await readControlActionOutcome(dedupKey);
    if (outcome?.state === 'success' || outcome?.state === 'failure') return outcome;
    if (waited < CONTROL_ACTION_PENDING_WAIT_MS) await sleep(CONTROL_ACTION_PENDING_POLL_MS);
  }
  return { state: 'pending' };
}
