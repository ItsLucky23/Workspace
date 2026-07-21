---
id: 0296
title: Global writes use encrypted durable Conductor jobs
status: accepted
date: 2026-07-21
tags: [conductor, reliability, security, multi-instance]
summary: Account, SSH, push, PAT and workspace-import writes persist as typed encrypted jobs and execute under the same renewable global writer lease as tenant-creation control actions.
---

## Context

ADR 0289 serialized account/global route callbacks only in one process. A crash lost the callback, multiple app instances had separate global chains, and persisting Web Push keys or import bundles as plaintext replay payloads would create a second sensitive-data store. Workspace import was additionally non-idempotent: retrying after a partial create could produce another workspace.

## Decision

Global route writes use the closed `GlobalAction` union and `GlobalJob` collection. The full validated payload is AES-256-GCM encrypted with `WORKSPACES_ENC_KEY`; searchable columns contain only job identity, kind, owner, status and retry metadata. Deterministic action hashing supplies the job ID and dedup key. Recovery replays only the typed union, with five bounded attempts.

Typed global jobs and login-only global control actions share one renewable Redis lease (`global`) and the explicit global writer context. Account updates, preferences, account deletion, SSH add/remove, Push save/remove, PAT revoke and workspace import no longer accept callback writers.

Session bearer tokens are never stored in a job. User rows are authoritative; the requesting route refreshes its derived session cache after job completion. Workspace import uses a deterministic workspace ID and an `importCompleted` marker. A partial import is deleted and rebuilt; a completed retry returns the same workspace.

## Rejected alternatives

- **Keep the callback seam:** it cannot be reconstructed and is only process-local.
- **Persist plaintext JSON:** duplicates Push credentials and portable workspace data outside their domain stores.
- **Persist session tokens for replay:** turns a reliability queue into a bearer-token vault.
- **Generate a new workspace ID on every attempt:** creates duplicate or partial workspaces after crashes.
- **Use only an in-process mutex:** does not provide a single writer across multiple instances.

## Consequences

- Global authoritative route writes are typed, encrypted, deduplicated and crash-replayable.
- The encryption key must remain available for both job recovery and backup restoration.
- Failed jobs stop after five attempts and retain a bounded error for operators.
- Session refresh and post-delete hooks remain non-authoritative observational work outside replay.
- `WS_GLOBAL_JOB_RECOVERY_MIN` controls the leader recovery cadence.
