---
title: Reusable output templates (named format specs) — O5
status: accepted
date: 2026-07-07
tags: [content, render, templates, freedom-program]
---

## Context

FREEDOM_PROGRAM item **O5**. The render format (aspect, watermark) had to be picked per generation (O1/O4).
A user producing a repeatable format (e.g. "vertical Reels with a bottom-right logo") had no way to save + reuse
that spec across pieces.

## Decision

- An `OutputTemplate` model (name + `format` [16:9/9:16/1:1] + `watermarkPosition`). `save-output-template` /
  `delete-output-template` control-ops (workTickets) validate the format/position + persist; the templates are
  exposed on `snapshot.outputTemplates` with client save/delete methods. A saved spec's `format` feeds the O1
  `resolveRenderFormat` → `buildFfmpegPlan` render plan directly.

## Rejected alternatives

- **A full composition spec (beats, transitions).** O5 is the reusable FORMAT (aspect + branding); a full
  composition template overlaps the E3 timeline + R1 pipeline-template work — kept to the format spec, which is
  the self-contained, immediately-reusable unit.
- **Store on the piece.** A template is workspace-level + reused ACROSS pieces (that's the point); a per-piece
  format is the O1 per-request path this complements.

## Consequences

- A workspace defines a named output format once and it drives renders across pieces (`outputTemplate` 9/9,
  incl. a saved spec producing the expected 720×1280 ffmpeg plan). This feeds R1 (save-as-template). The
  template-manager UI + the "apply this template to this render" wiring (threading the chosen template's format
  into `renderTimeline`) are follow-ups on top of the tested store + the O1/O4 render seam.
