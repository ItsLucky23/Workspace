---
title: The media registry consumes per-workspace keys + overrides, threaded through the provider
status: accepted
date: 2026-07-07
tags: [media, providers, secrets, multi-tenancy]
---

## Context

The in-app content Settings key-form (`save-media-provider`, ADR 0086) stores each provider key
encrypted as `EnvVar __provider_key_<providerId>` and each per-feature provider choice as
`EnvVar __media_provider_<feature>`. But `runMediaGeneration` read keys **only from `process.env`** —
every provider's `available()` / transport read `process.env.FAL_KEY` etc. directly. So an env key
worked, but a key entered in the app UI did nothing (it was stored, never consumed). FIX-A closes that.

## Decision

Keys are **threaded through the request**, not read from a global:

- `MediaGenerationRequest` gains an optional `apiKey`; `MediaProvider.available(apiKey?)` takes an
  optional key. Each provider resolves `apiKey ?? process.env.<KEY>` — an explicit per-workspace key
  wins, env is the fallback.
- Each provider's injectable transport gains a trailing `apiKey` param (the provider passes the
  already-resolved key). Test fixtures inject a transport with the *old* (fewer-param) signature, which
  stays assignable — so the fixture-based provider tests are unaffected.
- `server/media/workspaceKeys.ts` `loadWorkspaceMediaConfig(prisma, workspaceId)` reads the two EnvVar
  families in one query and **decrypts** the keys via the shared `secretBox` (fail-closed: a bad blob →
  no key → stub). `runMediaGeneration` calls it whenever `req.workspaceId` is set, merges the stored
  per-feature override under any explicit `overrides` arg, resolves the provider, and passes the
  decrypted key to `available()` + `generate()`.

## Rejected alternatives

- **Push the per-workspace key into `process.env` before dispatch.** Global mutation is not
  concurrency-safe (two workspaces generating at once would clobber each other's key) and leaks a
  tenant's secret into the process env. Threading through the request is tenant-safe by construction.
- **A provider-key registry / capability abstraction.** Over-engineered for three providers (Rule 7b);
  the request field + one loader is the minimal seam. (Distinct from the *parked* multi-**coding**-provider
  seam — that's the Claude-CLI engine, not media.)
- **Read the key in each content service and pass it down.** Spreads the decrypt + env-fallback logic
  across every caller; centralising it in the registry keeps every content service calling
  `runMediaGeneration` unchanged.

## Consequences

- A key entered in the app Settings now actually drives live generation, per workspace, alongside the
  env keys. No schema change (reuses the EnvVar store + secretBox). B-23 intact (the Conductor still
  writes the key; the registry only reads).
- `mediaWorkspaceKeys.test.mts` (8/8) proves the decrypt round-trip, the override parse, and that a
  stored key flips dispatch off the stub path (deterministically, via a bogus fal endpoint — no network).
