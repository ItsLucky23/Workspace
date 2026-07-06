---
id: 0061
title: Reference-video analysis → blueprint that seeds a script (F2.3)
status: accepted
date: 2026-07-06
tags: [content, reference-video, gemini, blueprint, expansion-f23]
supersedes: []
depends_on: [0049, 0052, 0055]
---

# Reference-video analysis (F2.3)

## Context

The user wants to "mimic another video's storytelling/pacing/style over a NEW story". F2.3 analyses a reference video (multimodal, Gemini) into a beat/style BLUEPRINT and retells a new story in that shape.

## Decision

`server/content/referenceVideo.ts` `analyzeReferenceVideo` calls the `reference-video-analysis` text AiFeature (Gemini, video-capable), producing a `VideoBlueprint` (`pacing`, `styleHint`, `beats[]`), then SEEDS a `Script` (title "From reference video") + `Beat`s from it — the NEW story in the reference's shape. Content-local stub (no key). Driven by `content-analyze-reference-video` (B-23, `workTickets`, requires `referenceVideoUrl` + `newStory`).

## Rejected alternatives

- **Return the blueprint only (no script).** Rejected — the deliverable is a usable Script the pipeline can continue with (voice→images→assemble); seeding it directly closes the loop.
- **A media feature.** Rejected — the analysis returns TEXT/structure (a blueprint), not an asset; it's a text AiFeature (F0.3 decision).
- **Copy the reference's actual story.** Rejected (by design + IP) — the blueprint captures STRUCTURE/style; the NEW story drives the content (the beats are about the new topic).

## Consequences

- New `server/content/referenceVideo.ts` + `content-analyze-reference-video` op. `tests/integration/referenceVideo.test.mts` (6): a reference + new story → a gemini-seeded Script + 4-beat arc where the NEW story drives the beats in the reference's hook-first shape. rbac 122/122. Live blueprint-JSON parsing is a keyed follow-up.
