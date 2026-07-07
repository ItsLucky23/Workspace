---
title: V3 — long-video decomposition (content-decompose-video)
status: accepted
date: 2026-07-08
tags: [content, video, decomposition, idea-to-outcome]
---

## Context

The user's flagship ask: "make a 60s video about X" should split into several shorter scenes that FLOW into
each other, then stitch. V1 gave the scene model, V2 the stitch. V3 is the step that turns a piece's storyboard
(script beats) into a generated, continuity-linked set of scenes.

## Decision

- **`buildContinuityPrompts(beats)`** (pure, tested): one prompt per beat, where every scene after the first is
  told to "continue seamlessly from the previous scene: <prev visual>", so consecutive clips are visually
  coherent. The first scene has no continuity hint; a beat with no `visualPrompt` falls back to its text.
- **`decomposeIntoScenes(...)`** generates a clip per beat via the shared queue-aware media lifecycle
  (`runQueuedMediaAsset`, feature `video-gen` — a stub clip without a key), and creates a `VideoScene` linking
  it. Scenes after the first crossfade in (`transitionIn: 'xfade'`) so they flow together. Budget-guarded
  (partial on cap) and re-decomposing REPLACES the scene list.
- **`content-decompose-video`** control-op (contentControl route, RBAC work-tickets): finds the piece's latest
  script and decomposes it; an optional `sceneDurationMs` sets the per-scene length.

## Rejected alternatives

- **Let the model emit the whole scene list in one JSON call.** The storyboard (script → beats) already IS the
  decomposition; reusing beats keeps one source of truth and one place to edit the narrative. V3 adds the
  continuity + the per-scene clip generation on top.
- **A new media feature for "scene clips".** `video-gen` already produces clips; a scene is just a clip plus
  timeline metadata (V1). No new provider surface.
- **Hard cuts between scenes.** The ask is scenes that "flow into each other" → crossfade by default (the editor
  can still set any scene to a hard cut via V1's save-scenes).

## Consequences

- A scripted piece can now be turned into an ordered, continuity-linked set of real video scenes with one op —
  the "idea → 60s multi-scene video" path, end to end with V2's stitch. Without a key the clips are stubs (the
  scene structure + prompts are still real + inspectable). The pure prompt builder is unit-tested; the op is
  integration-tested (scene-per-beat, transitions, continuity, replace-on-redecompose). Next: V4 (range-refine)
  then V5 (the timeline editor UI that drives save-scenes + decompose).
