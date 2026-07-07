---
title: O-C — content pipeline orchestration (content-run-pipeline)
status: accepted
date: 2026-07-08
tags: [content, orchestration, video, idea-to-outcome]
---

## Context

Even after V1–V4 (real video) the content side was still "a wall of manual generate buttons" — the user had to
fire script, then voice, then images/decompose, then assemble, one at a time. The "idea → outcome" promise
needs a single run that turns a brief into a complete piece. O-A lets the Assistant CREATE a content piece;
O-C makes it actually PRODUCE the video.

## Decision

- **`runContentPipeline(...)`** chains the existing step functions — `generateScript` → `generateVoiceover` →
  (`decomposeIntoScenes` for `mode:'video'` | `generateBeatImages` for `mode:'slideshow'`) → `assembleContent` —
  into one run. It reuses an existing script rather than regenerating (idempotent-ish), threads the real
  `scriptId`, and returns which steps ran + whether any output stubbed. NO new generation logic — it composes
  the reviewed step functions.
- **`content-run-pipeline`** control-op (contentControl route, RBAC work-tickets): `{ contentProjectId, mode? }`;
  `video` is the default (the marquee stitched-scene path).
- The run itself is the user's consent (B-23); per-step autonomy-gating (pause for approval between stages,
  reusing the autonomy dial) is a logged follow-up.

## Rejected alternatives

- **A new mega generation function.** Would duplicate the per-step logic + drift from the individual ops. O-C
  is pure orchestration over the same functions the manual buttons call.
- **Always regenerate the script.** Wasteful + would discard edits; reusing the latest script makes re-runs
  cheap and lets a user tweak the script then re-run visuals/assemble.
- **Auto-publish at the end.** Publishing crosses to the outside world (B-23 confirm-on-important); the pipeline
  stops at the render and leaves publish as its own gated op (`content-request-publish`).

## Consequences

- One op (or the Assistant, via O-B `create-content` then this) now turns a brief into a complete video:
  script → voiceover → decomposed stitched scenes → render. Without keys every artifact is an honest stub but
  the whole structure is real + inspectable. Integration-tested end to end (script+beats, voice, scene-per-beat,
  render; script reused on re-run). This completes the content "idea → outcome" backend: O-A/O-B (intake) →
  O-C (produce) → D1/D2 (publish). Follow-ups: per-step autonomy gating; the client "make the whole video"
  button; O-D (auto-activation).
