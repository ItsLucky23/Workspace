---
title: A style manager UI surfaces the save-style op — users author reusable named styles + pick them, not magic strings
status: accepted
date: 2026-07-07
tags: [content, styles, ux, freedom-program]
---

## Context

FREEDOM_PROGRAM item **Q3**. The `save-style` control-op + `StylePreset` model existed, but **no UI called
it**: the piece page had a free-text style box where the user typed a key that had to exactly match a seeded
preset (silently ignored otherwise). Users couldn't create, name, edit, or delete their own styles, and had to
guess magic strings.

## Decision

- A **style manager** section in content settings: lists every style (global builtins read-only; per-workspace
  ones editable/deletable), with a create form (feature + key + label + system prompt). Backed by the existing
  `save-style` op + a new **`delete-style`** op (removes a per-workspace style; builtins are filtered out).
- The snapshot's `ContentStyleSummary` now carries `systemPrompt` so the manager can show/edit it.
- The piece page's free-text style box is replaced by a **Dropdown** of known style keys (deduped across
  features) + a "No style" option — pick by name, never guess.

## Rejected alternatives

- **Keep the free-text key box.** It silently ignores an unknown key (`resolveStyle` returns null) — a confusing
  dead end. A picker of real styles is discoverable.
- **A full per-feature style editor with live preview.** Over-scoped for Q3; the create/edit/delete + picker is
  the core freedom. Live preview can come with the iteration items (Fase I).
- **Native `<select>`.** The framework `Dropdown` (keyboard nav, search, theme-aware) is the house component
  (enforced by `ai:lint`/eslint) — used for both the feature picker and the style picker.

## Consequences

- Users create and reuse their own named styles across every generation, and pick them from a list. Combined
  with Q2 (brand context) the creative output is genuinely steerable without touching code.
- `delete-style` is per-workspace-scoped and builtin-safe. Cross-workspace style sharing is a later item (R1/R2
  templates).
