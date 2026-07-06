//? Unit test for the bounded retry/backoff helper (server/util/retry). No DB. Verifies: succeeds
//? without retry, retries up to `attempts` then throws the last error, and STOPS early on a
//? non-retryable error. Uses tiny baseMs so the test is fast.

import { assert, eq, report } from '../_helpers.mts';

const { withRetry } = await import('../../server/util/retry.ts');

// 1) first-try success — called exactly once
{
  let calls = 0;
  const out = await withRetry(async () => { calls += 1; return 'ok'; }, { attempts: 3, baseMs: 1 });
  eq(out, 'ok', 'returns the value on first success');
  eq(calls, 1, 'no retry when the first attempt succeeds');
}

// 2) succeeds on the 3rd attempt
{
  let calls = 0;
  const out = await withRetry(async () => { calls += 1; if (calls < 3) throw new Error('blip'); return calls; }, { attempts: 3, baseMs: 1 });
  eq(out, 3, 'returns once an attempt succeeds');
  eq(calls, 3, 'retried until success');
}

// 3) exhausts attempts then throws the last error
{
  let calls = 0;
  let threw = '';
  try { await withRetry(async () => { calls += 1; throw new Error(`fail-${String(calls)}`); }, { attempts: 3, baseMs: 1 }); }
  catch (e) { threw = e instanceof Error ? e.message : String(e); }
  eq(calls, 3, 'tried exactly `attempts` times');
  eq(threw, 'fail-3', 'throws the LAST error after exhausting attempts');
}

// 4) non-retryable error stops immediately
{
  let calls = 0;
  let threw = '';
  try { await withRetry(async () => { calls += 1; throw new Error('permanent'); }, { attempts: 5, baseMs: 1, retryable: () => false }); }
  catch (e) { threw = e instanceof Error ? e.message : String(e); }
  eq(calls, 1, 'a non-retryable error is not retried');
  eq(threw, 'permanent', 'the permanent error propagates');
}

report('tests/unit/retry.test.mts');
