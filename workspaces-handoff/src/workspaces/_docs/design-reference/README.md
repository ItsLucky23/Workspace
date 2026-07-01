# design-reference — brand + visual provenance

> **What this is.** The original visual-design provenance for Workspaces, salvaged from the old `handoff/designs/` layer (2026-06-11) before that folder was removed. The **real, authoritative UI** is the TSX app in `../../` (screens/shell/components) — this folder is **reference only**: brand assets and the design tokens/intent the TSX was built against. The older JSX design prototype was intentionally **not** kept (the TSX supersedes it).

## Contents

| File | What it is |
|---|---|
| `assets/logo-mark.svg` · `logo-wordmark.svg` · `logo-wordmark-dark.svg` | The Workspaces brand logos (the only copies — use these for the app shell / PWA icons / favicons). |
| `DESIGN_TOKENS.md` | The design-token reference (colors, type, spacing) the visual language is built on. Maps onto the Tailwind `@theme` tokens the consumer app uses (root `CLAUDE.md` — Tailwind tokens only, never arbitrary hex). |
| `colors_and_type.css` | The original color + typography CSS from the design prototype — the concrete values behind the tokens. |
| `SCREEN_INVENTORY.md` | The intended screen list + layout intent (what each screen is for) — cross-check against the real `_screens/`. |
| `CLAUDE_DESIGN_FEATURE_COMPLETION.md` | The spec for the future **Design** pipeline stage/feature (a non-code `AgentRole`). Referenced by the main docs as a source spec; horizon-tier. |

## How to use

- **Building the app shell / PWA:** pull the logos from `assets/` and align the Tailwind `@theme` block with `DESIGN_TOKENS.md` / `colors_and_type.css`.
- **Adding a screen:** sanity-check intent against `SCREEN_INVENTORY.md`, but the TSX in `_screens/` is the source of truth.
- **The Design stage:** `CLAUDE_DESIGN_FEATURE_COMPLETION.md` is the future-horizon spec — not part of V1 (see [`../additions/00_INDEX.md`](../additions/00_INDEX.md) for the horizon set).
