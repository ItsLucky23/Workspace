//? GAP_SCAN D1 — the AI job queue: a concurrency cap + a circuit breaker in front of every provider call.
//?
//? There was NO limiter anywhere in the AI layer. N cron triggers firing in the same minute meant N
//? concurrent provider calls (and, for the PTY agent, N spawned processes) — the machine, not the product,
//? decided what happened next. And a provider that was down cost every caller the FULL timeout, twice
//? (the retry ladder), before failing.
//?
//? Two bounded primitives, both in-process and dependency-free:
//?   - a semaphore: at most K provider calls run at once, the rest queue in FIFO order;
//?   - a per-provider circuit breaker: after N consecutive failures the circuit OPENS and calls fail fast
//?     for a cooldown, then ONE probe decides whether to close it again (half-open).
//?
//? Deliberately per-instance: the leader-elected orchestrator (ADR 0015) already bounds who runs the
//? background loops, and a distributed limiter would need a Redis round-trip on the hot path.

import { tryCatch } from '@luckystack/core';

export const AI_MAX_CONCURRENT = Math.max(1, Number(process.env.WS_AI_MAX_CONCURRENT ?? '4'));
export const AI_BREAKER_THRESHOLD = Math.max(1, Number(process.env.WS_AI_BREAKER_FAILURES ?? '5'));
export const AI_BREAKER_COOLDOWN_MS = Math.max(1000, Number(process.env.WS_AI_BREAKER_COOLDOWN_MS ?? '60000'));

/* ------------------------------------------------------------------ semaphore */

export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  get inFlight(): number { return this.active; }
  get queued(): number { return this.waiters.length; }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      //? Hand the slot to the next waiter in FIFO order (fairness: no starvation under sustained load).
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}

/* ------------------------------------------------------------------ circuit breaker */

export type BreakerState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private probing = false;

  constructor(
    private readonly threshold = AI_BREAKER_THRESHOLD,
    private readonly cooldownMs = AI_BREAKER_COOLDOWN_MS,
  ) {}

  state(now: number): BreakerState {
    if (this.failures < this.threshold) return 'closed';
    return now - this.openedAt >= this.cooldownMs ? 'half-open' : 'open';
  }

  //? May a call proceed right now? An open circuit fails fast; a half-open one lets exactly ONE probe
  //? through (the rest keep failing fast) so a still-broken provider is not stampeded on recovery.
  allow(now: number): boolean {
    const state = this.state(now);
    if (state === 'closed') return true;
    if (state === 'open') return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  success(): void { this.failures = 0; this.openedAt = 0; this.probing = false; }

  failure(now: number): void {
    this.failures += 1;
    this.probing = false;
    if (this.failures >= this.threshold) this.openedAt = now;
  }
}

/* ------------------------------------------------------------------ the shared queue */

const semaphore = new Semaphore(AI_MAX_CONCURRENT);
const breakers = new Map<string, CircuitBreaker>();

const breakerFor = (key: string): CircuitBreaker => {
  const existing = breakers.get(key);
  if (existing) return existing;
  const created = new CircuitBreaker();
  breakers.set(key, created);
  return created;
};

export interface QueuedRun<T> {
  key: string;                       // the provider id — the breaker is per provider, not per feature
  run: () => Promise<T>;
  isFailure: (result: T) => boolean;  // a provider "result" can be a soft failure, not a throw
  onCircuitOpen: () => T;             // what the caller gets back when we fail fast
  now?: number;
}

//? Run a provider call under the cap + breaker. Throws are counted as failures and re-thrown (the caller's
//? own error handling stays in charge); soft failures are counted via `isFailure`.
export async function runQueued<T>(job: QueuedRun<T>): Promise<T> {
  const breaker = breakerFor(job.key);
  const at = job.now ?? Date.now();
  if (!breaker.allow(at)) return job.onCircuitOpen();
  return semaphore.run(async () => {
    //? A throw counts as a failure for the breaker and is re-thrown unchanged — the caller's own error
    //? handling stays in charge of what a failed turn means.
    //? `tryCatch` widens the value to `T | null`, so keep the result in a one-element tuple: the wrapper
    //? never returns null of its own accord, and a legitimately-null T survives.
    const [error, wrapped] = await tryCatch(async () => [await job.run()] as [T]);
    if (error || !wrapped) {
      breaker.failure(job.now ?? Date.now());
      throw error ?? new Error('ai.queueFailed');
    }
    const [result] = wrapped;
    if (job.isFailure(result)) breaker.failure(job.now ?? Date.now()); else breaker.success();
    return result;
  });
}

//? Observability for the AI activity panel / tests: what is running, waiting, and which providers are open.
export function aiQueueStatus(now = Date.now()): { inFlight: number; queued: number; limit: number; breakers: { key: string; state: BreakerState }[] } {
  return {
    inFlight: semaphore.inFlight,
    queued: semaphore.queued,
    limit: AI_MAX_CONCURRENT,
    breakers: [...breakers.entries()].map(([key, b]) => ({ key, state: b.state(now) })),
  };
}

//? Tests only: forget every breaker so one scenario cannot leak into the next.
export function resetAiBreakers(): void { breakers.clear(); }
