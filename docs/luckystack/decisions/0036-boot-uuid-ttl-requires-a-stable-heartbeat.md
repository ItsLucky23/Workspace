---
name: boot-uuid-ttl-requires-a-stable-heartbeat
title: Boot UUID TTL requires a stable environment-level heartbeat
status: accepted
date: 2026-07-22
deciders: [mathijs]
tags: [readiness, redis, boot-uuid, multi-instance, reliability]
supersedes: []
relates: []
---

## Context

The environment boot UUID is stored in Redis with a configurable TTL (one hour
by default). `/readyz` requires the key and the router cross-checks it against
`/_health`. The backend wrote it only once during construction, so every healthy
long-running process became not-ready when the TTL elapsed. Removing expiry
would fix that symptom but leave stale environments advertised forever.

The value also keys the default synchronized-env HMAC. Rotating it on every
refresh would make health hashes unstable and create races between the fallback
health response and the router's Redis comparison, especially when several
backend instances share one environment key.

## Decision

Keep the TTL and treat the UUID as an environment-level value. After HTTP listen
succeeds, every healthy backend starts an unref'd heartbeat at one third of the
configured TTL. A refresh uses `EXPIRE`, preserving the current value regardless
of which instance wrote it. If Redis reports that the key is missing, the first
refresher writes a new UUID.

Refreshes self-schedule only after the previous Redis operation settles, so an
outage cannot accumulate overlapping calls. Failures are logged and retried on
the next interval. Graceful server shutdown stops the heartbeat before resource
teardown.

## Rejected alternatives

- **Remove the TTL.** Prevents false not-ready responses but stale environment
  identities survive indefinitely after every backend dies.
- **Write a fresh UUID every interval.** Keeps the key alive but rotates router
  comparison data and `@bootUuid`-keyed health hashes continuously.
- **Only let the last writer renew an owner token.** In a multi-instance env, the
  key expires when that one process dies even while other backends remain healthy.
- **Use `setInterval` without serialization.** Slow or unavailable Redis can
  create overlapping refresh calls and an unbounded background backlog.

## Consequences

- A healthy server stays ready beyond `routing.bootKeyTtlSeconds`.
- Any healthy backend can preserve the current environment identity; restarts may
  still intentionally replace it through the initial boot write.
- When every backend stops, no heartbeat remains and Redis removes the key after
  the configured TTL.
- A Redis outage can still make readiness fail, but recovery recreates a missing
  UUID without requiring a process restart.
