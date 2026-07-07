---
title: Brand-kit portability — export/import the brand library as portable JSON (R3, brand half)
status: accepted
date: 2026-07-07
tags: [brand, portability, reuse, freedom-program]
---

## Context

FREEDOM_PROGRAM item **R3**. Customization must not be trapped in one workspace: a workspace's brand library
(palette / typography / voice / taglines / logo ideas) was `workspaceId`-locked with no way to move it to
another workspace or share it.

## Decision

- A pure `parseBrandKit(raw)` validates/normalizes a portable JSON blob into the existing `BrandLibraryInput`
  (reusing the same `str`/`strArr`/palette validators as the artifact-promote path). `exportBrandKit(ws)`
  reads the library → a portable kit (no ids/timestamps/workspaceId); `importBrandKit(ws, raw)` upserts it via
  the existing `saveBrandLibrary`. Two membership-gated `_api` routes (`brandExport`/`brandImport`) carry the
  JSON string.

## Rejected alternatives

- **A binary/opaque export.** Plain JSON is inspectable, hand-editable, and diffable — the right format for a
  "portable brand kit" a user copies between workspaces or shares.
- **A copy-op keyed on workspace ids (server-to-server).** Export-to-JSON + import-from-JSON also covers
  offline sharing + backup, and the round-trip is trivially testable; a direct copy op is a follow-up (R2).

## Consequences

- A brand kit round-trips losslessly between workspaces (`brandKitPortability` 14/14). This is the brand half of
  R3; the personal-defaults half (default style/brand/language on `UserPreferences` that follow the user into a
  new workspace's first piece) + the download/upload UI buttons are follow-ups on top of these tested
  export/import primitives.
