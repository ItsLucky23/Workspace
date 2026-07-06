//? Workspaces — a tiny bounded retry with exponential backoff for transient network ops
//? (git push to origin, forge REST calls). Not a circuit breaker — just "try a few times with
//? a growing delay" so a blip doesn't lose an authoritative merge push or a forge sync page.
//? Deterministic delays (no jitter) so tests can reason about total wait. Used by C1 (push) + C3
//? (forge API). Re-throws the LAST error after exhausting attempts.

import { sleep } from '@luckystack/core';

export interface RetryOptions {
  attempts?: number; // total tries, including the first (default 3)
  baseMs?: number;   // delay before the 2nd try; doubles each subsequent try (default 200)
  //? Return false to STOP retrying a given error (a permanent failure — e.g. a 4xx / a non-ff
  //? reject). Defaults to always-retry (treat every error as transient).
  retryable?: (error: unknown) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseMs = Math.max(0, opts.baseMs ?? 200);
  const retryable = opts.retryable ?? (() => true);
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    // eslint-disable-next-line luckystack/no-raw-try-catch -- a bounded retry must catch to decide whether to re-try; the custom tryCatch would flatten the loop's control flow.
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === attempts - 1 || !retryable(error)) break;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
