---
id: 0292
title: Typed route jobs use bounded replay and runtime claims
status: accepted
date: 2026-07-21
tags: [conductor, reliability, jobs, multi-instance]
summary: Replace workspace callback writes with validated InternalOps; replay only CAS-safe entity writes and claim slow runtime work outside the writer lease.
---

## Context

ADR 0289 moved legacy route callbacks under the Conductor, but their closures could not be reconstructed after a process crash. Studio generation, docs/image completion, chat persistence, design-library writes, PAT issuance, file saves and editor/preview launches therefore had writer serialization without durable replay. Slow Docker/proxy work also could not remain inside the workspace lease.

A naive replay of every persisted payload is unsafe: an old file, brand/style import or completion can overwrite a newer authoritative write. A periodic runtime sweep can also duplicate a launch that is merely slow rather than crashed.

## Decision

Workspace route writes use bounded, runtime-validated `InternalOp` payloads persisted in `WorkspaceSignal`. Deterministic Mongo IDs make create-style effects idempotent. The leader recovery sweep reconstructs only an explicit allowlist of idempotent operations and compares entity replay keys against later processed internal signals; a superseded signal is acknowledged without applying its stale payload. File and brand/style operations remain auditable typed signals but are excluded from crash replay until they gain an entity CAS/version that also covers out-of-band writers.

Editor, preview, ref-preview and preview-close use a durable prepare → external execute → typed completion protocol. Docker/proxy execution stays outside the workspace writer lease. A per-intent Redis lease prevents the normal request and recovery sweep from executing the same external launch concurrently; its TTL is configurable and recovery retries after ownership expires. The deterministic completion signal itself suppresses external re-execution even when its short authoritative apply still needs route-job recovery.

Runtime completion signals contain bounded status only. Credentials, raw PATs and other secrets are never persisted as replay payloads.

## Rejected alternatives

- **Keep callback closures:** serialized but not reconstructable after a crash.
- **Replay every unprocessed signal:** can overwrite newer state and can replay secret-bearing or out-of-band file effects unsafely.
- **Hold the workspace lease during Docker/AI work:** blocks unrelated authoritative writes for minutes and violates the short-completion invariant.
- **Use only the 30-second stale timer:** mistakes slow work for crashed work and duplicates external side effects.
- **Add a separate runtime-job collection immediately:** unnecessary for workspace jobs because the append-only signal already carries identity, ordering and bounded payloads.

## Consequences

- Crash-safe workspace completions are reconstructable and tenant/writer scoped.
- Old completions cannot overwrite a later processed write for the same entity.
- Runtime launches are nonblocking and cross-instance claimed, with recovery delayed until a crashed claim expires.
- Typed-but-non-CAS file and brand/style writes remain intentionally non-replayable rather than falsely advertised as durable.
- Global account/import writes still need a dedicated non-tenant durable collection before their callback seam can be removed.
