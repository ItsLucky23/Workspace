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

//? H5 — the active ZSET member is workspace-TAGGED (`<ws>::<ticketKey>`) so occupancy can be counted per
//? workspace (fair draining) while staying self-healing (the TTL eviction still works on the score). Pure encode.
const slotMember = (workspaceId: string, ticketKey: string): string => `${workspaceId}::${ticketKey}`;

export async function acquireSlot(ticketKey: string, workspaceId: string, force: boolean, now: number): Promise<boolean> {
  const [error, res] = await tryCatch(() =>
    redis.eval(ACQUIRE_LUA, 1, activeKey(), String(MAX_CONCURRENT_TURNS), force ? '1' : '0', String(now), String(SLOT_TTL_MS), slotMember(workspaceId, ticketKey)),
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
export async function releaseSlot(ticketKey: string, workspaceId: string): Promise<void> {
  await tryCatch(() => redis.zrem(activeKey(), slotMember(workspaceId, ticketKey)));
}

//? H5 — current occupancy PER WORKSPACE (evicts stale slots first, so the map self-heals after a crash). Feeds
//? the fair drain: a workspace holding fewer slots is served first, so one workspace can't starve the others.
export async function inFlightByWorkspace(now: number): Promise<Record<string, number>> {
  await tryCatch(() => redis.zremrangebyscore(activeKey(), '-inf', now - SLOT_TTL_MS));
  const [error, members] = await tryCatch(() => redis.zrange(activeKey(), 0, -1));
  const counts: Record<string, number> = {};
  if (error || !Array.isArray(members)) return counts;
  for (const m of members) {
    if (typeof m !== 'string') continue;
    const ws = m.includes('::') ? m.slice(0, m.indexOf('::')) : m;
    counts[ws] = (counts[ws] ?? 0) + 1;
  }
  return counts;
}

//? Pure — pick the fair next deferred turn: the EARLIEST-queued item whose workspace currently holds the FEWEST
//? slots (round-robin across workspaces; FIFO within a workspace). Returns the item + its queue index (for LREM),
//? or null when empty. This is what turns FIFO draining into fair draining.
export function pickFairNext(items: DeferredTurn[], inFlight: Record<string, number>): { item: DeferredTurn; index: number } | null {
  const first = items[0];
  if (first === undefined) return null;
  let bestItem = first;
  let best = 0;
  let bestLoad = inFlight[first.workspaceId] ?? 0;
  for (let i = 1; i < items.length; i += 1) {
    const it = items[i];
    if (it === undefined) continue;
    const load = inFlight[it.workspaceId] ?? 0;
    if (load < bestLoad) { bestItem = it; best = i; bestLoad = load; } // strictly-less keeps FIFO on ties
  }
  return { item: bestItem, index: best };
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

//? H5 — pop the FAIR next parked turn (least-loaded workspace first) instead of pure FIFO. Reads the queue,
//? picks via `pickFairNext`, and LREM-removes exactly that item. Falls back to null when empty.
export async function dequeueFairDeferred(inFlight: Record<string, number>): Promise<DeferredTurn | null> {
  const [rangeErr, raws] = await tryCatch(() => redis.lrange(queueKey(), 0, -1));
  if (rangeErr || !Array.isArray(raws) || raws.length === 0) return null;
  const parsed: { item: DeferredTurn; raw: string }[] = [];
  for (const raw of raws) {
    if (typeof raw !== 'string') continue;
    const [e, p] = tryCatchSync(() => JSON.parse(raw) as DeferredTurn);
    if (!e && p) parsed.push({ item: p, raw });
  }
  const pick = pickFairNext(parsed.map((p) => p.item), inFlight);
  if (!pick) return null;
  const chosen = parsed[pick.index];
  if (chosen === undefined) return null;
  await tryCatch(() => redis.lrem(queueKey(), 1, chosen.raw));
  await tryCatch(() => redis.srem(queuedSetKey(), chosen.item.key));
  return chosen.item;
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
