---
id: 0063
title: Music + SFX generation (F2.5)
status: accepted
date: 2026-07-06
tags: [content, music, sfx, audio, expansion-f25]
supersedes: []
depends_on: [0049, 0062]
---

# Music + SFX generation (F2.5)

## Context

The montage benefits from a soundtrack + sound effects. F2.5 adds music + sfx gen — both simple single-asset gens, so they reuse the shared `generateMediaAsset` path (F2.4).

## Decision

Music + sfx generation ride the `content-gen-music` / `content-gen-sfx` ops (already wired in F2.4's shared Conductor case → `generateMediaAsset` with feature `music`/`sfx`). Both default to the ElevenLabs adapter (stub, no key). Music (Suno) gets a dedicated provider later; for now it routes to the voice adapter's stub.

## Rejected alternatives

- **A dedicated music/sfx service.** Rejected — no per-feature specifics; the shared helper covers them (F2.4 decision).
- **Bake music/sfx into the assembly render.** Rejected — they're independent assets the montage (F1.5 / later) can mix; generating them separately keeps each asset's provenance + cost.

## Consequences

- No new engine code (ops wired in F2.4); F2.5 is the test + ADR proving music/sfx work. `tests/integration/musicSfx.test.mts` (6): music asset (elevenlabs) + sfx asset, budget music(6c)+sfx(1c)=7c. A dedicated Suno music provider + mixing into the render are follow-ups.
