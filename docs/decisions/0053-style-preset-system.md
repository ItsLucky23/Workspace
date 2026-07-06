---
id: 0053
title: Cross-cutting style/preset system (F0.4)
status: accepted
date: 2026-07-06
tags: [content, style, preset, expansion-f04]
supersedes: []
depends_on: [0049, 0050]
---

# Cross-cutting style/preset system (F0.4)

## Context

ADR 0049 makes styles a first-class, cross-cutting concept: every AI feature (text or media) composes a generation from `feature + input + style + free-form extra instructions`. A style is a curated system-prompt preset (e.g. `realistisch`, `cinematic`), with global defaults + per-workspace (brand) overrides. The `StylePreset` model exists (F0.1); F0.4 builds the resolve/compose/seed logic + the write path.

## Decision

1. **`server/content/styles.ts`** — `ensureDefaultStyles` (idempotent seed of the global `builtin` styles, `workspaceId=null`), `resolveStyle(prisma, ws, feature, key)` (a per-workspace style with the same key WINS over the global; no key/no match → null), `composeStylePrompt(style, extra)` (style system-prompt + free-form extra instructions, joined), and `listStyles` (global + workspace, the workspace shadowing the global — for the picker UI).
2. **Per-workspace styles are written via a `save-style` control-op** (B-23; capability `workspaceSettings`; Conductor upserts by `(workspace, feature, key)`). Global styles are seed-only (`builtin`, not user-writable).
3. **Styles thread into gen at the CALL SITE, not into `runAiCompletion`'s signature.** The content pipeline (F1.x) resolves the style + composes the system prompt, then passes it as `req.system` (text) or `MediaGenerationRequest.style` (media). No feature signature changes.

## Rejected alternatives

- **Change `runAiCompletion(feature, req)` to take `{ style, extraInstructions }`.** Rejected — the caller already composes the system prompt; threading style into every gen signature couples the abstraction to the style system. `composeStylePrompt` at the call site keeps both orthogonal.
- **Hardcode styles as a TS map (no DB).** Rejected — per-workspace (brand) styles are the whole point; a DB model (global `null` + per-workspace rows) is required, with the TS list only seeding the global defaults.
- **A dedicated `StyleRegistry` class.** Rejected — pure functions over the `StylePreset` model are simpler and trivially testable; "registry" is just the (feature,key)→preset lookup.

## Consequences

- New `server/content/styles.ts` + the `save-style` control-op (union + `OP_CAPABILITY` + Conductor case). The content pipeline (F1.2 script, F1.4 image, …) calls `resolveStyle` + `composeStylePrompt` when building gen requests.
- Seeded global styles cover image-gen/reference-image/video-gen/tts/script; more added as features land. `ensureDefaultStyles` runs idempotently (boot or test).
- `tests/integration/styleSystem.test.mts` (13 assertions): idempotent seed, resolve global, unknown→null, compose merge, per-workspace override wins, listStyles shadowing. `rbac.test` 122/122 with the new op.
