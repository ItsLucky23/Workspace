//? Stateful idempotency for public CI's slow external execution. The durable Conductor
//? prepare signal authorizes an immutable intent; this global Redis claim ensures only one
//? process executes that intent at a time. Redis stores only `pending:<owner>` or `success` —
//? never reports, forge data, logs, or secrets. A crashed pending owner expires for retry.

import { randomBytes } from 'node:crypto';

import { formatKey, redis, tryCatch } from '@luckystack/core';

const DEFAULT_CLAIM_TTL_MS = Number(process.env.WS_CI_EXTERNAL_CLAIM_TTL_MS ?? String(30 * 60 * 1000));
const SUCCESS_TTL_MS = Number(process.env.WS_CI_EXTERNAL_SUCCESS_TTL_MS ?? String(24 * 60 * 60 * 1000));
const INTENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const ciExternalClaimKey = (intentId: string): string => {
  if (!INTENT_PATTERN.test(intentId)) throw new Error('[ci] invalid external execution intent');
  return formatKey(':ci-external', intentId);
};

const CLAIM_LUA = `
local current = redis.call('GET', KEYS[1])
if current then return current end
local pending = 'pending:' .. ARGV[1]
local written = redis.call('SET', KEYS[1], pending, 'PX', ARGV[2], 'NX')
if written then return pending end
return redis.call('GET', KEYS[1])
`;

const OWNER_LUA = `
return redis.call('GET', KEYS[1]) == 'pending:' .. ARGV[1] and 1 or 0
`;

const RENEW_LUA = `
if redis.call('GET', KEYS[1]) == 'pending:' .. ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

const COMPLETE_LUA = `
if redis.call('GET', KEYS[1]) == 'pending:' .. ARGV[1] then
  redis.call('SET', KEYS[1], 'success', 'PX', ARGV[2])
  return 1
end
return 0
`;

const ABANDON_LUA = `
if redis.call('GET', KEYS[1]) == 'pending:' .. ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

export interface CiExternalExecutionClaim {
  intentId: string;
  token: string;
  ttlMs: number;
}

export type CiExternalClaimResult =
  | { state: 'claimed'; claim: CiExternalExecutionClaim }
  | { state: 'pending' }
  | { state: 'success' }
  | { state: 'unavailable' };

export async function claimCiExternalExecution(intentId: string, ttlMs = DEFAULT_CLAIM_TTL_MS): Promise<CiExternalClaimResult> {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) return { state: 'unavailable' };
  const token = randomBytes(16).toString('hex');
  const [error, raw] = await tryCatch(() => redis.eval(CLAIM_LUA, 1, ciExternalClaimKey(intentId), token, String(ttlMs)));
  if (error || typeof raw !== 'string') return { state: 'unavailable' };
  if (raw === `pending:${token}`) return { state: 'claimed', claim: { intentId, token, ttlMs } };
  if (raw === 'success') return { state: 'success' };
  return raw.startsWith('pending:') ? { state: 'pending' } : { state: 'unavailable' };
}

export async function ciExternalExecutionOwnsClaim(claim: CiExternalExecutionClaim): Promise<boolean> {
  const [error, owned] = await tryCatch(() => redis.eval(
    OWNER_LUA,
    1,
    ciExternalClaimKey(claim.intentId),
    claim.token,
  ));
  return error === null && owned === 1;
}

export async function renewCiExternalExecution(claim: CiExternalExecutionClaim): Promise<boolean> {
  const [error, renewed] = await tryCatch(() => redis.eval(
    RENEW_LUA,
    1,
    ciExternalClaimKey(claim.intentId),
    claim.token,
    String(claim.ttlMs),
  ));
  return error === null && renewed === 1;
}

export async function completeCiExternalExecution(claim: CiExternalExecutionClaim): Promise<boolean> {
  const [error, completed] = await tryCatch(() => redis.eval(
    COMPLETE_LUA,
    1,
    ciExternalClaimKey(claim.intentId),
    claim.token,
    String(SUCCESS_TTL_MS),
  ));
  return error === null && completed === 1;
}

export async function abandonCiExternalExecution(claim: CiExternalExecutionClaim): Promise<boolean> {
  const [error, abandoned] = await tryCatch(() => redis.eval(
    ABANDON_LUA,
    1,
    ciExternalClaimKey(claim.intentId),
    claim.token,
  ));
  return error === null && abandoned === 1;
}

export async function readCiExternalExecutionState(intentId: string): Promise<'missing' | 'pending' | 'success' | 'invalid'> {
  const [error, value] = await tryCatch(() => redis.get(ciExternalClaimKey(intentId)));
  if (error || value === null) return error ? 'invalid' : 'missing';
  if (value === 'success') return 'success';
  return value.startsWith('pending:') ? 'pending' : 'invalid';
}

export interface CiExternalClaimGuard {
  readonly signal: AbortSignal;
  assertOwned(): Promise<void>;
}

export class CiExternalClaimLostError extends Error {
  constructor(public readonly intentId: string) {
    super(`[ci] external execution claim lost for ${intentId}`);
    this.name = 'CiExternalClaimLostError';
  }
}

const waitForRenewal = (ms: number, signal: AbortSignal): Promise<boolean> => {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (elapsed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(elapsed);
    };
    const timer = setTimeout(() => { finish(true); }, ms);
    const onAbort = (): void => { finish(false); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

export async function withCiExternalClaimRenewal<T>(
  claim: CiExternalExecutionClaim,
  fn: (guard: CiExternalClaimGuard) => Promise<T>,
  renewEveryMs = Math.max(10, Math.floor(claim.ttlMs / 3)),
): Promise<T> {
  if (!Number.isSafeInteger(renewEveryMs) || renewEveryMs <= 0 || renewEveryMs > Math.floor(claim.ttlMs / 2)) {
    throw new Error('[ci] external claim renewal must run by half of its TTL');
  }
  const stop = new AbortController();
  const lost = new AbortController();
  const state: { error: CiExternalClaimLostError | null } = { error: null };
  const markLost = (): CiExternalClaimLostError => {
    const error = state.error ?? new CiExternalClaimLostError(claim.intentId);
    state.error = error;
    if (!lost.signal.aborted) lost.abort(error);
    return error;
  };
  const guard: CiExternalClaimGuard = {
    signal: lost.signal,
    assertOwned: async (): Promise<void> => {
      if (state.error) throw state.error;
      if (!(await ciExternalExecutionOwnsClaim(claim))) throw markLost();
    },
  };
  const maintenance = (async (): Promise<void> => {
    while (await waitForRenewal(renewEveryMs, stop.signal)) {
      if (!(await renewCiExternalExecution(claim))) {
        markLost();
        return;
      }
    }
  })();
  const [actionError, outcome] = await tryCatch(async () => {
    await guard.assertOwned();
    const value = await fn(guard);
    await guard.assertOwned();
    return { value };
  });
  stop.abort();
  const [maintenanceError] = await tryCatch(() => maintenance);
  if (maintenanceError) markLost();
  if (state.error) throw state.error;
  if (actionError) throw actionError;
  if (!outcome) throw new Error('[ci] external claim action returned no outcome');
  return outcome.value;
}
