---
title: M4 — media-style upload / copy / customize / delete (preview-aware)
status: accepted
date: 2026-07-08
tags: [content, media, style, import-export, ai-libraries-accounts]
---

## Context

M1 gave styles a preview asset + params. The style CRUD (save-style/delete-style) and the portable style-set
export/import already existed, but were TEXT-ONLY — a copied/shared style lost its preview. M4 makes the whole
CRUD + portability preview-aware.

## Decision

- **`save-style` + `delete-style` already do create/customize/delete** per-workspace (builtins stay read-only);
  M1 made `save-style` accept `previewAssetUrl`/`previewKind`.
- **The portable style-set carries the preview.** `StyleSetEntry` + `parseStyleSet` + `exportStyleSet` +
  `importStyleSet` gained `previewAssetUrl`/`previewKind`, so export → parse → import preserves the look. This
  is the "copy/share a style and keep its look" path.
- **Copy a builtin into the workspace = a `save-style` pre-filled** from the gallery/builtin entry (a new key,
  editable) — reusing the existing op, no new surface.

## Rejected alternatives

- **A dedicated copy op.** `save-style` already upserts by feature+key; a "copy" is just a save with the
  source's fields + a fresh key. No new op needed.
- **Store the preview outside the style-set JSON.** The preview is part of the style's identity; carrying it in
  the same portable entry keeps export/import a single self-contained artifact.

## Consequences

- A user can create, customize, delete, and export/import media styles WITH their preview intact. Proven E2E
  (5/5): save a style with a preview → export carries it → parse preserves it → import restores it. The
  preview-upload field + a copy button in the style manager are browser-verified in the shared pass. This
  closes Fase M (media/video-style library).
