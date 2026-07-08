---
title: V5 completion — the timeline audio track (waveform + voice/duck sliders)
status: accepted
date: 2026-07-08
tags: [content, video, audio, editor, render, idea-to-outcome]
---

## Context

V5's timeline editor shipped scenes + trim + transitions + range-refine, but the spec's last piece — "een
audio-spoor met de E4-waveform + volume/duck-sliders" — was missing, and the render only ever mixed the
voiceover (music + per-track gains were unreachable). This closes that gap so a user can see and balance the
audio and have it actually affect the rendered video.

## Decision

- **Per-piece mix on `ContentProject`** (MongoDB, no migration): `voiceVolume` (default 1) + `musicVolume`
  (default 0.25, ducked). Persisted by a new **`content-save-audio-mix`** control-op (content-* write family;
  no new frozen verb) — RBAC `workTickets`, clamped (voice ≤ 2, music ≤ 1) by the Conductor (B-23).
- **The render honours the gains.** `buildVideoStitchPlan` gained an optional `mix` ({musicFile, voiceVolume,
  musicVolume}); when there's music OR a non-default voice gain it routes voice (+ ducked music) through the
  existing `buildAudioMixPlan` (E4) → `[aout]`. **Guarded** so the plain single-voice path is byte-identical —
  the live render test is unchanged (re-run 7/7). `renderScenes` + `assembly` thread the piece's music asset
  + gains in.
- **The snapshot surfaces** `voiceVolume`/`musicVolume` + the newest voice/music asset urls on
  `ContentPieceSummary`, so the editor can draw the track without another fetch.
- **A real waveform** in `VideoTimelineEditor`: `decodePeaks` fetches + `decodeAudioData` → per-block peak
  bars on a canvas, theme-driven (fillStyle reads the canvas's resolved `text-primary`, no hardcoded hex),
  degrading to a flat baseline on any fetch/decode failure (stub url, no `AudioContext`). Voice + duck sliders
  save via `content-save-audio-mix`.

## Rejected alternatives

- **A per-scene audio model.** The mix is a whole-piece concern (one voiceover, one music bed); two float
  columns on the piece are far simpler than per-scene audio rows and match how `buildAudioMixPlan` works.
- **Rewriting the audio path to always use amix.** That would change the single-voice ffmpeg args and risk the
  proven live render. Gating amix behind "music present OR non-default gain" keeps the common path exactly as
  it was — the new branch only appears when the user actually asked for a mix.
- **A fake/static waveform image.** The spec says waveform; a real Web Audio decode is cheap, client-side, and
  honest, with a graceful baseline fallback so a stub asset still renders a track.

## Consequences

- The timeline now has a real audio track: the user sees the voice/music waveforms, balances voice gain +
  music duck, and the next render mixes at those gains. Verified: audioMix unit 15/15 (single-voice path
  proven unchanged), audioMixOp integration 9/9 (persist + clamp + snapshot), live render 7/7 (no regression).
  i18n ×4. This closes Fase V of the idea→outcome program in full.
