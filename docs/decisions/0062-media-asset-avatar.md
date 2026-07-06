---
id: 0062
title: Shared single-asset gen + avatar (F2.4)
status: accepted
date: 2026-07-06
tags: [content, avatar, media, expansion-f24]
supersedes: []
depends_on: [0049, 0052, 0056]
---

# Shared single-asset gen + avatar (F2.4)

## Context

Avatar/music/sfx/3d are simple "prompt (+ style) → one asset" gens with identical plumbing (budget → gen → asset → spend). F2.4 builds the shared helper + wires avatar; F2.5/F2.6 reuse it.

## Decision

`server/content/mediaAsset.ts` `generateMediaAsset(prisma, { feature, prompt?, referenceUrl?, styleKey?, extraInstructions? })` is the generic metered path for the simple single-asset features. The 4 ops (`content-gen-avatar`/`-music`/`-sfx`/`-3d`, B-23, `workTickets`) share ONE Conductor case that maps op→`MediaFeature` and calls it. The specialised services (voice timing, per-beat images, short-form captions, reference-image) keep their own files.

## Rejected alternatives

- **A separate service file per feature (avatar.ts, music.ts, …).** Rejected — they'd be near-identical; one generic helper + a mapped Conductor case is less code (consumer-side minimalism, Rule 7b).
- **One `content-gen-asset` op with a `feature` payload.** Rejected — explicit ops keep RBAC + the frozen op surface auditable (each op is a named capability), matching the other content ops.

## Consequences

- New `server/content/mediaAsset.ts` + 4 ops (avatar wired+tested here; music/sfx in F2.5, 3d in F2.6 — all share the case). `tests/integration/avatar.test.mts` (6): avatar asset (fal), MediaJob linked, budget 30c, block path. rbac 122/122.
