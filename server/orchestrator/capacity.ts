//? CapacityManager (#12, ADR 0019-sibling) — Redis is the host-wide admission AND
//? per-ticket run authority. Every admitted turn receives a unique reservation token;
//? stage writers must prove that token still owns workspace+ticket before any DB write.

import { createHash, randomUUID } from 'node:crypto';
import { redis, formatKey, tryCatch, tryCatchSync } from '@luckystack/core';

const MAX_CONCURRENT_TURNS = Number(process.env.WS_MAX_CONCURRENT_TURNS ?? '4');
//? Capacity ownership is a short renewable lease, not the hard turn-duration policy.
//? A healthy stage renews well inside this window; WS_TURN_MAX_MS belongs only to the watchdog.
const SLOT_TTL_MS = Number(process.env.WS_CAPACITY_LEASE_MS ?? '30000');
const CAPACITY_HASH_TAG = '{capacity}';

//? Leading `:` deliberately bypasses the tenant Redis formatter. Every Lua key also
//? carries the same Redis-Cluster hash tag, including per-ticket fence/heartbeat keys.
const capacityKey = (suffix: string): string => formatKey(':capacity', `${CAPACITY_HASH_TAG}:${suffix}`);
const activeKey = (): string => capacityKey('active');
const ownerKey = (): string => capacityKey('owners');
const queueKey = (): string => capacityKey('queue');
const queuedSetKey = (): string => capacityKey('queued');
const identityDigest = (workspaceId: string, ticketKey: string): string => createHash('sha256').update(workspaceId).update('\0').update(ticketKey).digest('hex');
const fenceKey = (workspaceId: string, ticketKey: string): string => capacityKey(`fence:${identityDigest(workspaceId, ticketKey)}`);
const heartbeatKey = (workspaceId: string, ticketKey: string, runToken: string): string => capacityKey(`heartbeat:${identityDigest(workspaceId, ticketKey)}:${runToken}`);

export function capacityRedisKeys(workspaceId: string, ticketKey: string, runToken: string): string[] {
  return [activeKey(), ownerKey(), queueKey(), queuedSetKey(), fenceKey(workspaceId, ticketKey), heartbeatKey(workspaceId, ticketKey, runToken)];
}

export interface DeferredTurn {
  workspaceId: string;
  key: string;
  stageId: string;
}

const EVICT_STALE_LUA = `
local stale = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[2]))
for _, member in ipairs(stale) do
  local identity = string.match(member, '^(.-)::%d+::[^:]+$')
  if identity and redis.call('HGET', KEYS[2], identity) == member then
    redis.call('HDEL', KEYS[2], identity)
  end
  redis.call('ZREM', KEYS[1], member)
end
`;

//? Admission, stale-owner eviction, and stale queued-item removal are one Redis
//? transaction. An urgent/direct admission can therefore never leave an older queued
//? copy behind for the drain loop to launch later.
const ACQUIRE_LUA = `
local queueType = redis.call('TYPE', KEYS[3]).ok
local queuedSetType = redis.call('TYPE', KEYS[4]).ok
if (queueType ~= 'none' and queueType ~= 'list') or (queuedSetType ~= 'none' and queuedSetType ~= 'set') then
  return redis.error_reply('capacity queue key has wrong type')
end
${EVICT_STALE_LUA}
local existingOwner = redis.call('HGET', KEYS[2], ARGV[5])
if existingOwner then
  local existingToken = string.match(existingOwner, '^.-::%d+::(.+)$')
  if existingToken and string.sub(existingToken, 1, 9) == 'recovery-' then return {-2, 0} end
  return {-1, 0}
end
local occupancy = redis.call('ZCARD', KEYS[1])
if tonumber(ARGV[4]) == 1 or occupancy < tonumber(ARGV[3]) then
  local fence = redis.call('INCR', KEYS[5])
  local member = ARGV[5] .. '::' .. tostring(fence) .. '::' .. ARGV[6]
  redis.call('SET', KEYS[6], member, 'PX', ARGV[2])
  redis.call('ZADD', KEYS[1], ARGV[1], member)
  redis.call('HSET', KEYS[2], ARGV[5], member)
  local queued = redis.call('LRANGE', KEYS[3], 0, -1)
  for _, raw in ipairs(queued) do
    local ok, item = pcall(cjson.decode, raw)
    if ok and item.workspaceId == ARGV[7] and item.key == ARGV[8] then
      redis.call('LREM', KEYS[3], 0, raw)
    end
  end
  redis.call('SREM', KEYS[4], ARGV[5])
  return {1, fence}
end
return {0, 0}
`;

const EVICT_AND_COUNT_LUA = `
${EVICT_STALE_LUA}
return redis.call('ZCARD', KEYS[1])
`;

const RELEASE_LUA = `
if redis.call('HGET', KEYS[2], ARGV[1]) == ARGV[2] then
  redis.call('HDEL', KEYS[2], ARGV[1])
  redis.call('ZREM', KEYS[1], ARGV[2])
  if redis.call('GET', KEYS[3]) == ARGV[2] then redis.call('DEL', KEYS[3]) end
  return 1
end
return 0
`;

const OWNER_LUA = `
${EVICT_STALE_LUA}
local owner = redis.call('HGET', KEYS[2], ARGV[3])
if owner == ARGV[4] and redis.call('ZSCORE', KEYS[1], ARGV[4]) and redis.call('GET', KEYS[3]) == ARGV[4] then
  return 1
end
return 0
`;

//? Renewal is one owner-checked atomic operation. The expiring heartbeat prevents a
//? stalled old process from resurrecting after TTL; ZADD refreshes host occupancy.
const RENEW_LUA = `
if redis.call('HGET', KEYS[2], ARGV[1]) == ARGV[2]
  and redis.call('ZSCORE', KEYS[1], ARGV[2])
  and redis.call('GET', KEYS[3]) == ARGV[2] then
  redis.call('PEXPIRE', KEYS[3], ARGV[4])
  redis.call('ZADD', KEYS[1], ARGV[3], ARGV[2])
  return 1
end
return 0
`;

const ENQUEUE_LUA = `
local listType = redis.call('TYPE', KEYS[1]).ok
local setType = redis.call('TYPE', KEYS[2]).ok
if (listType ~= 'none' and listType ~= 'list') or (setType ~= 'none' and setType ~= 'set') then
  return redis.error_reply('capacity queue key has wrong type')
end
if redis.call('SADD', KEYS[2], ARGV[1]) ~= 1 then
  return 0
end
redis.call('RPUSH', KEYS[1], ARGV[2])
return 1
`;

const DEQUEUE_FIFO_LUA = `
local raw = redis.call('LPOP', KEYS[1])
if not raw then return false end
local ok, item = pcall(cjson.decode, raw)
if ok and item.workspaceId and item.key then
  redis.call('SREM', KEYS[2], item.workspaceId .. '::' .. item.key)
end
return raw
`;

const REMOVE_QUEUED_LUA = `
local listType = redis.call('TYPE', KEYS[1]).ok
local setType = redis.call('TYPE', KEYS[2]).ok
if (listType ~= 'none' and listType ~= 'list') or (setType ~= 'none' and setType ~= 'set') then
  return redis.error_reply('capacity queue key has wrong type')
end
local removed = redis.call('LREM', KEYS[1], 1, ARGV[1])
if removed == 1 then
  redis.call('SREM', KEYS[2], ARGV[2])
end
return removed
`;

const FORGET_QUEUED_LUA = `
local queued = redis.call('LRANGE', KEYS[1], 0, -1)
for _, raw in ipairs(queued) do
  local ok, item = pcall(cjson.decode, raw)
  if ok and item.workspaceId == ARGV[1] and item.key == ARGV[2] then
    redis.call('LREM', KEYS[1], 0, raw)
  end
end
redis.call('SREM', KEYS[2], ARGV[1] .. '::' .. ARGV[2])
return 1
`;

//? Recovery takes authority in one Redis transaction. A boot/reaper recovery may only
//? claim an expired/missing owner; a hard-turn-max recovery may explicitly revoke the
//? exact still-live old owner. A different/higher owner always wins and makes this stale.
const PREPARE_RECOVERY_LUA = `
local owner = redis.call('HGET', KEYS[2], ARGV[3])
local heartbeat = redis.call('GET', KEYS[4])
local score = redis.call('ZSCORE', KEYS[1], ARGV[4])
local scoreLive = score ~= false and tonumber(score) > tonumber(ARGV[1]) - tonumber(ARGV[2])
if owner then
  if owner ~= ARGV[4] then return {-1, 0} end
  local fullyLive = heartbeat == ARGV[4] and scoreLive
  local inconsistent = (heartbeat == ARGV[4] and score == false) or (heartbeat ~= ARGV[4] and scoreLive)
  if inconsistent then return {-1, 0} end
  if fullyLive and tonumber(ARGV[8]) ~= 1 then return {-2, 0} end
elseif score or (heartbeat and heartbeat ~= ARGV[4]) then
  return {-1, 0}
end
local fence = tonumber(redis.call('GET', KEYS[3]) or '0')
if fence ~= tonumber(ARGV[5]) then return {-1, 0} end
if owner == ARGV[4] then
  redis.call('HDEL', KEYS[2], ARGV[3])
  redis.call('ZREM', KEYS[1], ARGV[4])
end
if heartbeat == ARGV[4] then redis.call('DEL', KEYS[4]) end
local recoveryFence = redis.call('INCR', KEYS[3])
if recoveryFence ~= tonumber(ARGV[5]) + 1 then return redis.error_reply('unexpected recovery fence') end
redis.call('SET', KEYS[5], ARGV[6], 'PX', ARGV[2])
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[6])
redis.call('HSET', KEYS[2], ARGV[3], ARGV[6])
return {1, recoveryFence}
`;

//? A canceled external attempt rolls back only its provisional recovery fence while
//? it still owns the identity. It never restores the old owner, so a possibly-live old
//? Claude remains fenced; a later retry or normal successor receives expected+1 safely.
const CANCEL_RECOVERY_LUA = `
if redis.call('HGET', KEYS[2], ARGV[1]) ~= ARGV[2]
  or not redis.call('ZSCORE', KEYS[1], ARGV[2])
  or redis.call('GET', KEYS[4]) ~= ARGV[2] then
  return 0
end
if tonumber(redis.call('GET', KEYS[3]) or '0') ~= tonumber(ARGV[3]) then return 0 end
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[1], ARGV[2])
redis.call('DEL', KEYS[4])
redis.call('SET', KEYS[3], ARGV[4])
return 1
`;

//? A processed durable prepare may outlive its short recovery heartbeat when the
//? process crashes before Docker/complete. Re-establishing the SAME deterministic
//? recovery member is safe only when no owner exists and the fence is still exact.
const RESTORE_RECOVERY_LUA = `
${EVICT_STALE_LUA}
local owner = redis.call('HGET', KEYS[2], ARGV[3])
local score = redis.call('ZSCORE', KEYS[1], ARGV[4])
local heartbeat = redis.call('GET', KEYS[4])
if owner == ARGV[4] and score and heartbeat == ARGV[4] then
  redis.call('PEXPIRE', KEYS[4], ARGV[2])
  redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
  return 1
end
if owner or score or (heartbeat and heartbeat ~= ARGV[4]) then return 0 end
if tonumber(redis.call('GET', KEYS[3]) or '0') ~= tonumber(ARGV[5]) then return 0 end
redis.call('SET', KEYS[4], ARGV[4], 'PX', ARGV[2])
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('HSET', KEYS[2], ARGV[3], ARGV[4])
return 1
`;

const slotIdentity = (workspaceId: string, ticketKey: string): string => `${workspaceId}::${ticketKey}`;

export interface SlotReservation {
  workspaceId: string;
  ticketKey: string;
  runToken: string;
  fence: number;
  member: string;
}

function createReservation(workspaceId: string, ticketKey: string, runToken: string, fence: number): SlotReservation {
  return { workspaceId, ticketKey, runToken, fence, member: `${slotIdentity(workspaceId, ticketKey)}::${String(fence)}::${runToken}` };
}

function readAcquireResult(value: unknown): { state: -2 | -1 | 0 | 1; fence: number } | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const state: unknown = value[0];
  const fence: unknown = value[1];
  if ((state !== -2 && state !== -1 && state !== 0 && state !== 1) || typeof fence !== 'number' || !Number.isSafeInteger(fence) || fence < 0) return null;
  return { state, fence };
}

export type SlotAcquireResult =
  | { acquired: true; reservation: SlotReservation }
  | { acquired: false; reason: 'duplicate' | 'recovering' | 'full' | 'unavailable' };

export async function acquireSlot(
  ticketKey: string,
  workspaceId: string,
  force: boolean,
  now: number,
  evaluate: (runToken: string) => Promise<unknown> = (runToken) => redis.eval(
    ACQUIRE_LUA,
    6,
    activeKey(),
    ownerKey(),
    queueKey(),
    queuedSetKey(),
    fenceKey(workspaceId, ticketKey),
    heartbeatKey(workspaceId, ticketKey, runToken),
    String(now),
    String(SLOT_TTL_MS),
    String(MAX_CONCURRENT_TURNS),
    force ? '1' : '0',
    slotIdentity(workspaceId, ticketKey),
    runToken,
    workspaceId,
    ticketKey,
  ),
): Promise<SlotAcquireResult> {
  const runToken = randomUUID();
  const [error, rawResult] = await tryCatch(() => evaluate(runToken));
  const result = readAcquireResult(rawResult);
  if (error || !result) {
    console.error('[capacity] acquireSlot failed, rejecting (fail-closed):', error?.message ?? 'invalid Redis result');
    return { acquired: false, reason: 'unavailable' };
  }
  if (result.state === 1 && result.fence > 0) return { acquired: true, reservation: createReservation(workspaceId, ticketKey, runToken, result.fence) };
  if (result.state === -2) return { acquired: false, reason: 'recovering' };
  return { acquired: false, reason: result.state === -1 ? 'duplicate' : 'full' };
}

//? Strict owner probes preserve the distinction recovery needs: `false` means Redis
//? definitely says "not this owner"; transport/script uncertainty throws. Ordinary stage
//? guards intentionally keep the historical fail-closed boolean wrapper below.
export async function reservationOwnsSlotStrict(
  workspaceId: string,
  ticketKey: string,
  runToken: string,
  fence: number,
  now = Date.now(),
  evaluate: () => Promise<unknown> = () => {
    const member = `${slotIdentity(workspaceId, ticketKey)}::${String(fence)}::${runToken}`;
    return redis.eval(
      OWNER_LUA,
      3,
      activeKey(),
      ownerKey(),
      heartbeatKey(workspaceId, ticketKey, runToken),
      String(now),
      String(SLOT_TTL_MS),
      slotIdentity(workspaceId, ticketKey),
      member,
    );
  },
): Promise<boolean> {
  if (!Number.isSafeInteger(fence) || fence <= 0) return false;
  const result = await evaluate();
  if (result !== 0 && result !== 1) throw new Error('[capacity] invalid owner result');
  return result === 1;
}

//? Exported stage-authority check. It atomically expires old reservations and then
//? proves both HASH ownership and ZSET residency for the exact token.
export async function reservationOwnsSlot(
  workspaceId: string,
  ticketKey: string,
  runToken: string,
  fence: number,
  now = Date.now(),
  evaluate?: () => Promise<unknown>,
): Promise<boolean> {
  const [error, owned] = await tryCatch(() => evaluate === undefined
    ? reservationOwnsSlotStrict(workspaceId, ticketKey, runToken, fence, now)
    : reservationOwnsSlotStrict(workspaceId, ticketKey, runToken, fence, now, evaluate));
  return error === null && owned === true;
}

export async function renewReservation(reservation: SlotReservation, now = Date.now()): Promise<boolean> {
  const [error, renewed] = await tryCatch(() => redis.eval(
    RENEW_LUA,
    3,
    activeKey(),
    ownerKey(),
    heartbeatKey(reservation.workspaceId, reservation.ticketKey, reservation.runToken),
    slotIdentity(reservation.workspaceId, reservation.ticketKey),
    reservation.member,
    String(now),
    String(SLOT_TTL_MS),
  ));
  return error === null && renewed === 1;
}

export async function releaseSlotStrict(
  reservation: SlotReservation,
  evaluate: () => Promise<unknown> = () => redis.eval(
    RELEASE_LUA,
    3,
    activeKey(),
    ownerKey(),
    heartbeatKey(reservation.workspaceId, reservation.ticketKey, reservation.runToken),
    slotIdentity(reservation.workspaceId, reservation.ticketKey),
    reservation.member,
  ),
): Promise<boolean> {
  const released = await evaluate();
  if (released !== 0 && released !== 1) throw new Error('[capacity] invalid release result');
  return released === 1;
}

export async function releaseSlot(reservation: SlotReservation): Promise<boolean> {
  const [error, released] = await tryCatch(() => releaseSlotStrict(reservation));
  return error === null && released === true;
}

export type RecoveryPrepareResult =
  | { prepared: true; reservation: SlotReservation }
  | { prepared: false; reason: 'live' | 'stale' | 'unavailable' };

export function recoveryRunToken(intentId: string): string {
  return `recovery-${intentId}`;
}

export function recoveryReservation(workspaceId: string, ticketKey: string, intentId: string, oldFence: number): SlotReservation {
  return createReservation(workspaceId, ticketKey, recoveryRunToken(intentId), oldFence + 1);
}

export async function prepareRecoveryReservation(input: {
  workspaceId: string;
  ticketKey: string;
  oldRunToken: string;
  oldRunFence: number;
  intentId: string;
  allowLiveOwner: boolean;
  now: number;
}): Promise<RecoveryPrepareResult> {
  const recovery = recoveryReservation(input.workspaceId, input.ticketKey, input.intentId, input.oldRunFence);
  const oldMember = createReservation(input.workspaceId, input.ticketKey, input.oldRunToken, input.oldRunFence).member;
  const [error, raw] = await tryCatch(() => redis.eval(
    PREPARE_RECOVERY_LUA,
    5,
    activeKey(),
    ownerKey(),
    fenceKey(input.workspaceId, input.ticketKey),
    heartbeatKey(input.workspaceId, input.ticketKey, input.oldRunToken),
    heartbeatKey(input.workspaceId, input.ticketKey, recovery.runToken),
    String(input.now),
    String(SLOT_TTL_MS),
    slotIdentity(input.workspaceId, input.ticketKey),
    oldMember,
    String(input.oldRunFence),
    recovery.member,
    recovery.runToken,
    input.allowLiveOwner ? '1' : '0',
  ));
  const result = readAcquireResult(raw);
  if (error || !result) return { prepared: false, reason: 'unavailable' };
  if (result.state === 1 && result.fence === recovery.fence) return { prepared: true, reservation: recovery };
  return { prepared: false, reason: result.state === -2 ? 'live' : 'stale' };
}

export async function reservationFenceStrict(
  workspaceId: string,
  ticketKey: string,
  evaluate: () => Promise<unknown> = () => redis.get(fenceKey(workspaceId, ticketKey)),
): Promise<number> {
  const value = await evaluate();
  const fence = typeof value === 'string' ? Number(value) : value;
  if (typeof fence !== 'number' || !Number.isSafeInteger(fence) || fence < 0) {
    throw new Error('[capacity] invalid fence result');
  }
  return fence;
}

export async function ensureRecoveryReservation(
  recovery: SlotReservation,
  now = Date.now(),
  evaluate: () => Promise<unknown> = () => redis.eval(
    RESTORE_RECOVERY_LUA,
    4,
    activeKey(),
    ownerKey(),
    fenceKey(recovery.workspaceId, recovery.ticketKey),
    heartbeatKey(recovery.workspaceId, recovery.ticketKey, recovery.runToken),
    String(now),
    String(SLOT_TTL_MS),
    slotIdentity(recovery.workspaceId, recovery.ticketKey),
    recovery.member,
    String(recovery.fence),
  ),
): Promise<boolean> {
  const restored = await evaluate();
  if (restored !== 0 && restored !== 1) throw new Error('[capacity] invalid recovery-restore result');
  return restored === 1;
}

export async function cancelRecoveryReservationStrict(
  recovery: SlotReservation,
  oldFence: number,
  evaluate: () => Promise<unknown> = () => redis.eval(
    CANCEL_RECOVERY_LUA,
    4,
    activeKey(),
    ownerKey(),
    fenceKey(recovery.workspaceId, recovery.ticketKey),
    heartbeatKey(recovery.workspaceId, recovery.ticketKey, recovery.runToken),
    slotIdentity(recovery.workspaceId, recovery.ticketKey),
    recovery.member,
    String(recovery.fence),
    String(oldFence),
  ),
): Promise<boolean> {
  if (recovery.fence !== oldFence + 1) return false;
  const canceled = await evaluate();
  if (canceled !== 0 && canceled !== 1) throw new Error('[capacity] invalid recovery-cancel result');
  return canceled === 1;
}

export async function cancelRecoveryReservation(recovery: SlotReservation, oldFence: number): Promise<boolean> {
  const [error, canceled] = await tryCatch(() => cancelRecoveryReservationStrict(recovery, oldFence));
  return error === null && canceled === true;
}

export async function inFlightByWorkspace(now: number): Promise<Record<string, number>> {
  await tryCatch(() => redis.eval(EVICT_AND_COUNT_LUA, 2, activeKey(), ownerKey(), String(now), String(SLOT_TTL_MS)));
  const [error, members] = await tryCatch(() => redis.zrange(activeKey(), 0, -1));
  const counts: Record<string, number> = {};
  if (error || !Array.isArray(members)) return counts;
  for (const member of members) {
    if (typeof member !== 'string') continue;
    const workspaceId = member.includes('::') ? member.slice(0, member.indexOf('::')) : member;
    counts[workspaceId] = (counts[workspaceId] ?? 0) + 1;
  }
  return counts;
}

export function pickFairNext(items: DeferredTurn[], inFlight: Record<string, number>): { item: DeferredTurn; index: number } | null {
  const first = items[0];
  if (first === undefined) return null;
  let bestItem = first;
  let best = 0;
  let bestLoad = inFlight[first.workspaceId] ?? 0;
  for (let index = 1; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) continue;
    const load = inFlight[item.workspaceId] ?? 0;
    if (load < bestLoad) {
      bestItem = item;
      best = index;
      bestLoad = load;
    }
  }
  return { item: bestItem, index: best };
}

function parseDeferred(raw: string): DeferredTurn | null {
  const [error, value] = tryCatchSync(() => JSON.parse(raw) as unknown);
  if (error || value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return 'workspaceId' in value && typeof value.workspaceId === 'string' && value.workspaceId.length > 0
    && 'key' in value && typeof value.key === 'string' && value.key.length > 0
    && 'stageId' in value && typeof value.stageId === 'string' && value.stageId.length > 0
    ? { workspaceId: value.workspaceId, key: value.key, stageId: value.stageId }
    : null;
}

export async function enqueueDeferred(
  item: DeferredTurn,
  evaluate: () => Promise<unknown> = () => redis.eval(
    ENQUEUE_LUA,
    2,
    queueKey(),
    queuedSetKey(),
    slotIdentity(item.workspaceId, item.key),
    JSON.stringify(item),
  ),
): Promise<boolean> {
  const [error, added] = await tryCatch(evaluate);
  return error === null && added === 1;
}

export async function dequeueDeferred(): Promise<DeferredTurn | null> {
  for (;;) {
    const [error, raw] = await tryCatch(() => redis.eval(DEQUEUE_FIFO_LUA, 2, queueKey(), queuedSetKey()));
    if (error || raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') continue;
    const parsed = parseDeferred(raw);
    if (parsed) return parsed;
  }
}

//? Fair removal is owner-safe across concurrent drainers: LREM and SREM happen in one
//? script, and a drainer that loses the LREM race retries from a fresh queue snapshot.
export async function dequeueFairDeferred(inFlight: Record<string, number>): Promise<DeferredTurn | null> {
  for (;;) {
    const [rangeError, raws] = await tryCatch(() => redis.lrange(queueKey(), 0, -1));
    if (rangeError || !Array.isArray(raws) || raws.length === 0) return null;
    const parsed: { item: DeferredTurn; raw: string }[] = [];
    for (const raw of raws) {
      if (typeof raw !== 'string') continue;
      const item = parseDeferred(raw);
      if (item) parsed.push({ item, raw });
      else await tryCatch(() => redis.lrem(queueKey(), 1, raw));
    }
    const pick = pickFairNext(parsed.map((entry) => entry.item), inFlight);
    if (!pick) continue;
    const chosen = parsed[pick.index];
    if (!chosen) continue;
    const [removeError, removed] = await tryCatch(() => redis.eval(
      REMOVE_QUEUED_LUA,
      2,
      queueKey(),
      queuedSetKey(),
      chosen.raw,
      slotIdentity(chosen.item.workspaceId, chosen.item.key),
    ));
    if (!removeError && removed === 1) return chosen.item;
  }
}

export async function dequeueDeferredUntil<T>(
  inFlight: Record<string, number>,
  resolve: (item: DeferredTurn) => Promise<T | null>,
): Promise<{ item: DeferredTurn; value: T } | null> {
  for (;;) {
    const item = await dequeueFairDeferred(inFlight);
    if (!item) return null;
    const value = await resolve(item);
    if (value !== null) return { item, value };
  }
}

export async function forgetDeferred(workspaceId: string, ticketKey: string): Promise<void> {
  await tryCatch(() => redis.eval(FORGET_QUEUED_LUA, 2, queueKey(), queuedSetKey(), workspaceId, ticketKey));
}

export async function activeCount(now: number): Promise<number> {
  const [error, count] = await tryCatch(() => redis.eval(EVICT_AND_COUNT_LUA, 2, activeKey(), ownerKey(), String(now), String(SLOT_TTL_MS)));
  return error || typeof count !== 'number' ? 0 : count;
}

//? Read-model count: unlike `activeCount`, this never evicts stale slots or rewrites owner state.
//? Snapshot reads use this; admission/drain/metrics retain the maintenance-capable counter above.
export async function activeCountReadOnly(now: number): Promise<number> {
  const [error, count] = await tryCatch(() => redis.zcount(activeKey(), `(${String(now - SLOT_TTL_MS)}`, '+inf'));
  return error || typeof count !== 'number' ? 0 : count;
}

export interface ReservationRenewalTimings { renewEveryMs: number }
export interface ReservationGuard {
  readonly signal: AbortSignal;
  assertOwned(): Promise<void>;
}

export class ReservationLostError extends Error {
  constructor(public readonly reservation: SlotReservation) {
    super(`[capacity] reservation lost for ${reservation.workspaceId}/${reservation.ticketKey} fence ${String(reservation.fence)}`);
    this.name = 'ReservationLostError';
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

const DEFAULT_RESERVATION_RENEWAL_TIMINGS: Readonly<ReservationRenewalTimings> = {
  renewEveryMs: Math.max(100, Math.floor(SLOT_TTL_MS / 3)),
};

export async function withReservationRenewal<T>(
  reservation: SlotReservation,
  fn: (guard: ReservationGuard) => Promise<T>,
  timings: Readonly<ReservationRenewalTimings> = DEFAULT_RESERVATION_RENEWAL_TIMINGS,
): Promise<T> {
  if (!Number.isSafeInteger(timings.renewEveryMs) || timings.renewEveryMs <= 0 || timings.renewEveryMs >= SLOT_TTL_MS / 2) {
    throw new Error('[capacity] renewal must run before half of the reservation TTL');
  }
  const stop = new AbortController();
  const lost = new AbortController();
  const state: { error: ReservationLostError | null } = { error: null };
  const markLost = (): ReservationLostError => {
    const error = state.error ?? new ReservationLostError(reservation);
    state.error = error;
    if (!lost.signal.aborted) lost.abort(error);
    return error;
  };
  const guard: ReservationGuard = {
    signal: lost.signal,
    assertOwned: async (): Promise<void> => {
      const currentError = state.error;
      if (currentError) throw currentError;
      if (!(await reservationOwnsSlot(reservation.workspaceId, reservation.ticketKey, reservation.runToken, reservation.fence))) throw markLost();
    },
  };
  const maintenance = (async (): Promise<void> => {
    while (await waitForRenewal(timings.renewEveryMs, stop.signal)) {
      if (!(await renewReservation(reservation))) {
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
  if (!outcome) throw new Error('[capacity] reservation action returned no outcome');
  return outcome.value;
}

export const capacityLimit = (): number => MAX_CONCURRENT_TURNS;
export const capacitySlotTtlMs = (): number => SLOT_TTL_MS;

export async function queueLength(): Promise<number> {
  const [error, count] = await tryCatch(() => redis.llen(queueKey()));
  return error || typeof count !== 'number' ? 0 : count;
}
