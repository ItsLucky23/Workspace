//? CapacityManager (#12, ADR 0019-sibling) — a REAL host-wide admission control for
//? autonomous AI turns, replacing the old racy soft-cap (a `count() >= MAX` check that a
//? burst could TOCTOU past). A turn must `acquireSlot` before it runs and `releaseSlot`
//? when it ends; a rejected turn is parked on a FIFO queue and re-provisioned the moment a
//? slot frees (`drainNext`). Multi-instance-safe (all state in shared Redis; ADR 0015) and
//? crash-leak-resistant (slots are ZSET members scored by acquire-time and evicted once
//? older than a turn's max lifetime, so a crashed instance's slots self-heal — the #1
//? watchdog is the belt to this suspenders).
//?
//? Hotfix/security force-through (#12): an `urgent`-priority ticket is ALWAYS admitted
//? (bypasses the cap) — it still needs approval to merge (ADR 0018). It is tracked in the
//? active set so normal tickets see true occupancy, but its admission never blocks.

import { redis, formatKey, tryCatch, tryCatchSync } from '@luckystack/core';

//? Hard cap on concurrent autonomous turns host-wide. `WS_MAX_CONCURRENT_TURNS` (default 4).
const MAX_CONCURRENT_TURNS = Number(process.env.WS_MAX_CONCURRENT_TURNS ?? '4');
//? A slot older than this is treated as leaked (its instance died mid-turn) and evicted on the
//? next acquire, so a crash can never permanently consume capacity. Generous — longer than any
//? real turn. `WS_TURN_MAX_MS` (default 30 min).
const SLOT_TTL_MS = Number(process.env.WS_TURN_MAX_MS ?? String(30 * 60 * 1000));

const activeKey = (): string => formatKey('capacity', 'active'); // ZSET member=ticketKey score=acquiredAt
const queueKey = (): string => formatKey('capacity', 'queue');   // LIST of JSON deferred items (FIFO)
const queuedSetKey = (): string => formatKey('capacity', 'queued'); // SET of queued ticketKeys (dedupe)

//? A deferred turn waiting for a slot. Re-provisioned verbatim when one frees.
export interface DeferredTurn {
  workspaceId: string;
  key: string;
  stageId: string;
}

//? Atomic admission: evict stale slots, then admit iff forced (urgent) OR occupancy < cap.
//? One Redis round-trip, so N concurrent activations can never all read "3 busy" and each
//? add a 4th (the soft-cap's bug). Returns true = admitted (a slot is now held for `key`).
const ACQUIRE_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[3]) - tonumber(ARGV[4]))
local occupancy = redis.call('ZCARD', KEYS[1])
if tonumber(ARGV[2]) == 1 or occupancy < tonumber(ARGV[1]) then
  redis.call('ZADD', KEYS[1], ARGV[3], ARGV[5])
  return 1
end
return 0
`;

export async function acquireSlot(ticketKey: string, force: boolean, now: number): Promise<boolean> {
  const [error, res] = await tryCatch(() =>
    redis.eval(ACQUIRE_LUA, 1, activeKey(), String(MAX_CONCURRENT_TURNS), force ? '1' : '0', String(now), String(SLOT_TTL_MS), ticketKey),
  );
  if (error) {
    //? Redis down → fail OPEN (admit) rather than freeze the whole engine; the DB-level
    //? per-workspace serialisation still bounds real concurrency. Logged, not swallowed.
    console.error('[capacity] acquireSlot failed, admitting (fail-open):', error.message);
    return true;
  }
  return res === 1;
}

//? Free the slot held for `key` (idempotent — a missing member is a no-op).
export async function releaseSlot(ticketKey: string): Promise<void> {
  await tryCatch(() => redis.zrem(activeKey(), ticketKey));
}

//? Park a rejected turn on the FIFO queue (deduped — a ticket already queued is not re-added,
//? so repeated re-entries don't stack duplicates). Returns whether it was newly queued.
export async function enqueueDeferred(item: DeferredTurn): Promise<boolean> {
  const [addErr, added] = await tryCatch(() => redis.sadd(queuedSetKey(), item.key));
  if (addErr || added !== 1) return false; // already queued (or redis error) → don't double-push
  await tryCatch(() => redis.rpush(queueKey(), JSON.stringify(item)));
  return true;
}

//? Pop the next parked turn (FIFO), or null if the queue is empty.
export async function dequeueDeferred(): Promise<DeferredTurn | null> {
  const [error, raw] = await tryCatch(() => redis.lpop(queueKey()));
  if (error || typeof raw !== 'string') return null;
  const [parseErr, parsed] = tryCatchSync(() => JSON.parse(raw) as DeferredTurn);
  if (parseErr || !parsed) return null;
  await tryCatch(() => redis.srem(queuedSetKey(), parsed.key));
  return parsed;
}

//? Remove a ticket from the deferred SET without popping the list (used when a queued ticket
//? gets admitted out-of-band, e.g. re-entered as urgent — keeps the dedupe set honest).
export async function forgetDeferred(ticketKey: string): Promise<void> {
  await tryCatch(() => redis.srem(queuedSetKey(), ticketKey));
}

//? Current occupancy (after evicting stale slots) — for observability / the busy banner.
export async function activeCount(now: number): Promise<number> {
  const [, ] = await tryCatch(() => redis.zremrangebyscore(activeKey(), '-inf', now - SLOT_TTL_MS));
  const [error, n] = await tryCatch(() => redis.zcard(activeKey()));
  return error || typeof n !== 'number' ? 0 : n;
}

export const capacityLimit = (): number => MAX_CONCURRENT_TURNS;

//? Number of turns parked on the deferred FIFO queue (observability #5 — the admission backlog).
export async function queueLength(): Promise<number> {
  const [error, n] = await tryCatch(() => redis.llen(queueKey()));
  return error || typeof n !== 'number' ? 0 : n;
}
