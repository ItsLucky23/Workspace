---
title: L2 — designer persistence round-trip (consume the snapshot's designArtifacts)
status: accepted
date: 2026-07-08
tags: [design, persistence, library, ai-libraries-accounts]
---

## Context

The Designer's libraries (themes/styles/anims) were client-held `useState` seeded from `SEED_*`. Saving a
look wrote a `DesignArtifact` (save + setActive), but nothing loaded them BACK — persistence was
one-directional, so a saved theme vanished on reload and never appeared in the gallery/rails. The snapshot
already exposes the full `designArtifacts` rows (content included); they were consumed only for the active
name.

## Decision

- **Consume the existing snapshot `designArtifacts` — no new `list`/`load` op.** The snapshot IS the list.
  `persisted.ts` parses each row back into the typed shape (`artifactToTheme`/`Style`/`Anim` + a
  `parsePersistedLibraries` splitter), defensively: a malformed/half-set row coerces to null (never crashes
  the designer). The content shapes match what `useInProject` writes (`{light,dark}` for a theme, the full
  spec for a style/anim).
- **`state.tsx` merges the persisted artifacts into the libraries** via a `useEffect` on `designArtifacts`,
  appending by id (idempotent), never clobbering unsaved local edits. So a saved look reappears on reload AND
  live right after saving (refetch → the effect re-runs).

## Rejected alternatives

- **Add a `list`/`load` op to `designerLibrary`.** Redundant — the snapshot already carries the rows with
  content; a second fetch path would duplicate the data + add a round-trip. Reusing the snapshot keeps one
  source of truth and updates live via the existing realtime refetch.
- **Replace the seed libraries with the persisted set.** The seeds are the always-available defaults; persisted
  artifacts AUGMENT them (append), so a user never loses the built-in palettes/styles.

## Consequences

- Saved themes/styles/anims now round-trip: they show in the library rails + the L1 gallery on reload and
  immediately after saving. Proven E2E (7/7 vs real Mongo): save → snapshot surfaces it → parses back with the
  tokens/spec intact; a half-set token row is rejected. L3 builds copy/customize/delete + upload on top of this
  round-trip.
