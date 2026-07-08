---
title: L3 — designer import / copy / customize / delete
status: accepted
date: 2026-07-08
tags: [design, gallery, import, crud, ai-libraries-accounts]
---

## Context

L1 gave a premade-look gallery and L2 the persistence round-trip. L3 lets a user make the library their own:
copy a premade into their workspace, import a theme/style JSON, customize it, and delete their own.

## Decision

- **Copy a premade → workspace artifacts.** `lookToArtifacts(resolved)` produces a theme artifact (its
  palette) + a style artifact (its component spec with the look's fonts baked in), saved via the existing
  `designerLibrary` `save` op. They round-trip (L2) into the editable rails, so "copy" = "make it mine".
- **Import a theme/style/anim JSON.** A file picker in the gallery reads the JSON, and **`validArtifactContent`
  (pure, reuses the L2 coercion) refuses anything that isn't a real theme/style/anim** before saving — a
  garbage upload can't poison the library. Reuses `save`; no new op.
- **Customize + delete reuse existing surfaces.** Rail edits (rename/duplicate/token-edit) now persist through
  L2; delete is the existing per-workspace `deleteDesignArtifact` (premades/seeds stay read-only).

## Rejected alternatives

- **A dedicated `import` op with server-side parsing.** The `save` op already accepts `{kind,name,content}`;
  the only gap was client-side validation, which `validArtifactContent` covers. A second op would duplicate
  `save`.
- **Bundle premium webfonts (SF Pro, etc.) for the looks.** The font library already ships 18 distinct system/
  web-safe stacks, so font variety is delivered without any download or CSP exception. Premium/licensed
  webfonts are a licensing + bundle-size concern and are deliberately NOT bundled (per the run's decision);
  the `fontHeading`/`fontBody` model can carry a self-hosted `@font-face` later if a licensed face is added.

## Consequences

- The design gallery is now a full library the user owns: copy a premade, import a JSON, customize the tokens,
  delete your own — all persisted + round-tripping. Pure import/copy logic unit-tested (31/31); the save round-
  trip is L2's E2E (7/7); the gallery UI (copy/import buttons + file picker) browser-verified in the shared
  pass. This closes Fase L (design reference library). Webfonts scoped to the existing stacks; licensed faces
  are a documented follow-up.
