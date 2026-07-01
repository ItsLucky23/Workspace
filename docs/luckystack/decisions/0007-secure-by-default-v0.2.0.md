---
name: secure-by-default-v0.2.0
title: Flip the default-insecure-but-opt-in framework defaults to secure-by-default for v0.2.0
status: accepted
date: 2026-06-15
deciders: [ItsLucky23]
tags: [security, config, sync, server, secret-manager, logging]
supersedes: []
relates: []
---

## Context

Six independent codebase scans (wave-1) + three reconciliation scans (wave-2) named a recurring theme: several security-relevant framework defaults shipped *permissive* and relied on the consumer to opt into the secure behaviour (an undocumented-as-required step). v0.2.0 is pre-1.0, so a one-time breaking move toward secure-by-default is acceptable now in a way it won't be after 1.0.

## Decision

Flip four defaults in `@luckystack/core` `DEFAULT_PROJECT_CONFIG` (and the secret-manager package) to fail closed:

- **Sync receiver-auth** — `sync.allowClientReceiverAll` `true→false` and `sync.requireRoomMembership` `false→true`. A client can no longer broadcast to the cluster-wide `'all'` receiver nor fan out to a room it never joined; `authorizeSyncReceiver` already read these keys, only the defaults changed.
- **/_health hash** — `http.healthHash` `{mode:'plain',salt:''}` → `{mode:'hmac',salt:'@bootUuid'}`, so the unauthenticated `/_health` endpoint no longer publishes a stable, offline-dictionary-attackable `sha256(secret)`; the synchronized-env fingerprint is HMAC-keyed on the per-boot UUID server+router already share. Collapses to `'plain'` when no boot UUID exists so the boot handshake never silently diverges.
- **Log redaction** — add `csrftoken`/`apikey`/`secret` to `DEFAULT_REDACTED_LOG_KEYS` and make `isRedactedLogKey` also redact any key whose lowercased form *ends with* `token`/`secret`/`apikey`/`password` (so `targetToken`/`clientSecret` mask without registration).
- **secret-manager `envNames`** — when unset, resolve NOTHING off-host (+ boot warning) instead of scanning the whole inherited env and POSTing pointer-shaped values off-host. (The deliberate fail-OPEN when the manager URL is unset is unchanged — see existing decision memory.)

## Rejected alternatives

- **Keep permissive defaults, document the opt-in** — rejected: security defaults must not be silently delegated to an undocumented-as-required opt-in; pre-1.0 is the moment to take the breaking change.
- **`hmac` with an empty salt** — rejected: the hasher falls back to plain on an empty key, producing NO security change silently.
- **Require a consumer-configured static health salt** — rejected: hard-breaks every existing boot handshake on upgrade; the boot UUID is a zero-config shared key that also rotates per restart.
- **Arbitrary substring redaction match** — rejected: over-redacts benign keys (`tokenCount`, `secretSanta`); suffix-match is the precise rule.

## Consequences

Breaking for consumers who relied on cluster-wide/arbitrary-room broadcast, the legacy `/_health` wire output, or implicit whole-env secret scanning — they must join the room / approve via `preSyncAuthorize` / set `mode:'plain'` / set `envNames` explicitly. Documented as BREAKING in `packages/core/CLAUDE.md` and `packages/sync/CLAUDE.md`. All four are individually revertible via config.
