---
title: M1 — style preview asset + thumbnail affordance
status: accepted
date: 2026-07-08
tags: [content, media, style, gallery, ai-libraries-accounts]
---

## Context

Media styles were a text-only list (label + systemPrompt) picked from a name dropdown — nothing showed a
sample of the LOOK, so a user couldn't say "I like THIS look". `StylePreset.params` already existed; only a
preview reference was missing.

## Decision

- **Two nullable columns on `StylePreset`**: `previewAssetUrl` (a sample image/video of the style) +
  `previewKind` ('image'|'video') — MongoDB, no migration. Threaded through `listStyles` (ResolvedStyle), the
  `save-style` op, and the snapshot's `content.styles`, so a style carries its preview end to end.
- **The picker shows the chosen style's preview** (a looping muted `<video>` or an `<img>` thumbnail) when the
  style has one — turning the name dropdown into a look-first choice without replacing it.

## Rejected alternatives

- **A separate preview-asset table.** Two nullable columns on the row the picker already reads is far simpler;
  the preview is intrinsic to the style.
- **Generate a preview on the fly per style.** Costly + non-deterministic; a stored sample (uploaded by a user
  or seeded) is cheap and stable. Builtins ship without a preview until one is authored (the field is optional).

## Consequences

- A style can now show its look. Proven E2E (6/6): save-style persists the preview, `listStyles` + the snapshot
  carry it, the picker renders the thumbnail. M4 lets a user upload/attach a preview when saving a custom
  style; M3 uses the styled-video path (M2) for "pick a look → make a video".
