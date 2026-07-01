---
name: one-time-tokens-hashed-at-rest
title: Store one-time tokens (password-reset, email-change) hashed at rest; never the raw token
status: accepted
date: 2026-06-15
deciders: [ItsLucky23]
tags: [security, login, core, redis]
supersedes: []
relates: []
---

## Context

`@luckystack/login` stored password-reset and email-change tokens using the RAW token as the Redis key. A Redis dump, an over-broad read, or a backup leak would expose directly-usable account-takeover tokens. The same pattern was hand-rolled in multiple login flows.

## Decision

Add a shared `@luckystack/core` primitive: `issueOneTimeToken(namespace, ttlSeconds, payload) -> { token, store() }` plus `consumeOneTimeToken` / `consumeOneTimeTokenJson`. It stores `sha256(token)` (hex) as the Redis key via `formatKey(namespace, hash)`; the raw token is returned to the caller exactly once and never persisted. Consume is a single `MULTI` `GET`+`DEL` (at-most-once even under concurrent redemption). `store()` is deferred from `issue()` so callers can run veto/validation between minting and committing without orphaning a key. `@luckystack/login` migrated both flows to it.

## Rejected alternatives

- **Store the raw token as the key (the existing pattern)** — rejected: a storage/backup leak exposes directly-usable tokens; hashing at rest forces a 256-bit preimage brute-force.
- **Combine issue + store into one call** — rejected: removes the safe veto window and risks orphaned keys when a downstream hook aborts the flow after the key is written.

## Consequences

A Redis leak no longer yields usable reset/email-change tokens. Round-trip + no-reuse tests pin the primitive. Any future single-use-token flow should use this primitive rather than re-hand-rolling key storage.
