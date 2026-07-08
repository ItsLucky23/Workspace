---
title: M2 — thread the style through the video path (decompose)
status: accepted
date: 2026-07-08
tags: [content, video, style, media, ai-libraries-accounts]
---

## Context

Picking a style ("stick-man figures") only affected the SLIDESHOW path (per-beat images all styled). The
real-video path was ungenerated-style: `runContentPipeline` did not pass its `opts` to `decomposeIntoScenes`,
and `decomposeIntoScenes` had no `styleKey` param — it sent each scene's beat prompt with NO `style`. So a
styled video request produced unstyled clips. This is the single highest-value content fix in the program.

## Decision

- **`decomposeIntoScenes` resolves the piece's `video-gen` style and rides it on every scene request.** It
  gained `styleKey`/`extraInstructions` params, calls `resolveStyle(ws, 'video-gen', styleKey)`, and passes
  `request.style` + `styleId` — the exact pattern `images.ts` already uses for the slideshow path.
- **`buildSceneRequest` is extracted (pure + exported)** so a unit test asserts the style rides every scene-
  gen request, deterministically.
- **The wiring is completed end-to-end:** `runContentPipeline` now forwards `...opts` to `decomposeIntoScenes`,
  and the two conductor ops (`content-run-pipeline`, `content-decompose-video`) forward `styleKey` +
  `extraInstructions` from the payload.

## Rejected alternatives

- **A per-scene style override.** The style is a whole-piece identity (one look across all scenes); one
  resolved style threaded through decompose matches how the slideshow path + `resolveStyle` already work.
- **Store the style on each VideoScene row.** The style is applied at GENERATION time (composeMediaPrompt),
  not persisted per scene; carrying it on the request (like images.ts) keeps one code path.

## Consequences

- A chosen style now lands on EVERY generated scene clip, so "make a 60s video about the moon landing in
  stick-man figures" actually produces stick-man scenes. The continuity prompts (already present) keep the
  scenes visually consistent across the styled look. Proven: `buildSceneRequest` unit 6/6 (style + extra
  instructions ride the request), a DB-side integration 4/4 (a saved video-gen style resolves + reaches the
  request), and no regression (decomposeVideo 9/9). This unblocks M3 (pick-a-look + topic → styled video).
