---
title: L1 — premade UI-look gallery (curated combos over the existing seeds)
status: accepted
date: 2026-07-08
tags: [design, gallery, themes, ui, ai-libraries-accounts]
---

## Context

The Designer module already had the building blocks — palettes (DesignTheme), component styles (DesignStyle,
incl. Apple/Material/Glass/Brutalist), animations, fonts — with live-preview via `themeVars`/`styleVars`. But
there was no curated CATALOG of ready-made looks to browse + apply, and no rich preview surfaces (a real
landing/menu/animation/font showcase). L1 adds that reference gallery.

## Decision

- **A premade-look catalog as curated COMBINATIONS of the existing seeds** (`premades.ts`): a "look" pairs a
  seed palette + a seed style + an animation + heading/body fonts. Eight starter looks (Apple, Material, Glass,
  Brutalist, Minimal, Editorial, Playful, Neumorphic) — a strong STARTER that upload/copy/customize (L3)
  extends. Pure data + a `resolveLook` resolver; no new palette authoring.
- **A `Gallery` section** (now the Designer's default tab) renders the catalog as thumbnails and, for the
  selected look, live preview SURFACES under the look's vars: a nav menu, a landing hero, a card row, a
  replayable entrance animation (motion/react + the seed AnimSpec), and a font showcase. Tailwind colour
  classes inside the preview read the OVERRIDDEN `--color-*` vars, so the subtree re-themes; `--ds-*` drives
  the shapes. "Use this look" applies its theme + style via the existing persist path.

## Rejected alternatives

- **Author ~20 brand-new full palettes upfront.** 30 tokens × light+dark × 20 = a huge hand-authoring cost
  for the first run; the decided scope is a strong extensible starter. Distinctiveness comes from style + font
  + palette combos, and users add their own (L3).
- **A separate preview renderer divorced from the Designer.** The Designer's `themeVars`/`styleVars` +
  Tailwind-reads-the-vars pattern already re-themes any subtree; the gallery reuses it, so a look previews
  exactly as it will apply.

## Consequences

- The Designer opens on a browsable gallery of premade looks, each previewing a real landing/menu/animation/
  font surface and applying in one click. Pure catalog unit-tested (43/43); live preview browser-verified in
  the shared pass. L2 wires the persisted-artifact round-trip into the same gallery; L3 adds upload/copy/
  customize/delete + self-hosted webfonts. i18n ×4.
