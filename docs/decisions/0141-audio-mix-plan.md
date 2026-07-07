---
title: Audio mix plan — voice + ducked music + sfx → one mixed track (E4, mix half)
status: accepted
date: 2026-07-08
tags: [editors, audio, render, freedom-program]
---

## Context

FREEDOM_PROGRAM item **E4** — an audio editor: trim + mix voice + music + sfx (music ducked under voice) into a
single track the render consumes. The render had a single voice track only; no multi-track mix.

## Decision

- A pure `buildAudioMixPlan(tracks)` builds the ffmpeg `-filter_complex` that mixes N tracks — each with a
  per-track linear volume (voice ~1, music ducked ~0.25, sfx ~0.6) + an optional `atrim` — into one `[aout]`
  stream via `amix=inputs=N:duration=longest`. Returns the filter + the output map for the render to wire in.

## Rejected alternatives

- **Sidechain-compress ducking (auto-duck under voice).** True sidechain ducking is a nice upgrade; a fixed
  music-volume duck is the honest, deterministic, unit-testable first cut — the volumes are the E4 waveform UI's
  outputs.
- **A client-side Web Audio mixdown.** The render is ffmpeg-in-container; producing the mix there (one filter)
  keeps a single render path + avoids uploading a large mixed blob. The waveform UI edits the mix PARAMETERS
  (per-track volume + trim) this plan consumes.

## Consequences

- Voice + music + sfx mix into one track with per-track volume + trim, as a pure, unit-tested ffmpeg filter
  (`renderFormats` 31/31 incl. the mix cases). The **waveform UI** (Web Audio visual + trim handles that emit
  these track params) is the browser-verified follow-up; wiring the plan into `renderTimeline`'s audio input is
  a small follow-up on this tested primitive.
