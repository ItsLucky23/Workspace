---
severity: high
area: core / redis / secret-manager
date: 2026-07-13
tags: [redis, secret-manager, boot, caching, ioredis]
---

# Nulling a cached client is not enough — a client captured at construction must be REPLACED (registered), not reset

## What happened

0.6.3 shipped a fix for the Redis secret-manager-POINTER boot bug: when
`config.secretManager.url` is set, the server boot (and a decoupled hook) called
`resetDefaultRedisClient()` — which nulls the memoized `cachedDefault` so the next
`getRedisClient()` lazily rebuilds. Real testing proved it did NOT fix it: the boot
still authenticated with the literal pointer `REDIS_PASSWORD_V1` and failed with
`WRONGPASS`. A consumer's `registerRedisClient(new Redis(getRedisConnectionOptions()))`
DID work. So it was fully a framework bug, and the "reset" mechanism was wrong.

## Root cause

ioredis reads `options.password` ONCE at construction and replays it on every
reconnect/AUTH — it never re-reads `process.env`. Two ways a plain reset fails:

1. **Deferred rebuild.** `resetDefaultRedisClient()` only sets `cachedDefault = null`
   and DEFERS the rebuild to the next lazy `getRedisClient()`. Between the reset and
   that later call (here ~15s, after type-map generation), a stale/pointer value can
   resurface, so the lazily-rebuilt client bakes in the pointer again.
2. **Can't override a registered client.** `resetDefaultRedisClient()` touches only
   `cachedDefault`, not the `redisClients` registry. `getRedisClientFor('default')`
   returns a REGISTERED client BEFORE consulting the resolver — so if anything
   registered a default client built pre-resolution, reset never drops it.

The consumer workaround worked precisely because `registerRedisClient(...)` builds the
client EAGERLY (capturing the resolved password at that instant) AND puts it in the
registry slot that wins over the resolver.

## How to avoid

For any client that captures a credential at construction (ioredis, DB pools, SDKs),
the fix after a late secret resolution is to **eagerly rebuild + REGISTER a fresh
client**, not to null a cache and hope the lazy rebuild reads the right value. Core now
exposes `rebuildDefaultRedisClient()` (disconnect previous → construct from current env →
`registerRedisClient`), used by the server boot and the `notifySecretsResolved` hook.
`resetDefaultRedisClient()` remains but is documented as insufficient for this case.

General principle: "invalidate the cache" ≠ "capture the correct value now." When the
value source (`process.env`) can change or be read at the wrong time, capture eagerly
into the slot that authoritatively wins. Related:
[[0005-npm-run-eats-no-provenance-flag]] (same 0.6.x release line).
