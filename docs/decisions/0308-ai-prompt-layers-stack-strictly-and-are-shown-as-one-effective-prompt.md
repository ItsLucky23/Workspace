---
id: 0308
title: AI prompt layers stack strictly, and are shown as one effective prompt
status: superseded
date: 2026-08-17
tags: [ai, pipeline, ia, ux]
supersedes: []
superseded_by: [0311]
---

> **Superseded by ADR 0311.** The "one strict stack of five" described below was never checked
> against `server/orchestrator/renderStage.ts`, and is wrong: the fields travel in two independent
> channels, and layer 1 never reached the coding agent at all. The *problem* stated here is real and
> still worth reading; the *decision* is not what the code does.

## Context

The UI audit (`src/workspaces/_docs/UI_AUDIT_2026-08-17.md`) found that FIVE separate free-text
fields shape the prompt of a single Develop-pipeline agent:

1. the workspace-level AI instruction (`src/workspaces/workspace/page.tsx`),
2. the AI Skills instructions + "apply points" on the same page,
3. the per-stage `systemPrompt` (`develop/pipeline/stageTabs.tsx`),
4. the per-stage `customInstructions` (the stage's CLAUDE.md),
5. the carry-over `promptTemplate`.

Nothing in the UI states the order, and the only hint — "layered above your instructions" — never
says above *what*. The ticket detail shows the stage config read-only with no link to the layers.
A code comment acknowledged the relationship existed but it was never surfaced to a user.

The owner independently reported this as a top frustration, having spotted two of the five layers.
A second, unrelated stack exists in Content/Studio (`brief.tone` vs workspace `brand.voice` vs
per-generation `refine` vs channel `brandVoice`) with the same defect.

## Decision

**Strict layering.** The layers always concatenate in the fixed order above; a non-empty stage
field never silently replaces a workspace-level one. There is no per-stage opt-out.

The order is resolved by ONE helper (`resolveAiLayers()`), and both the stage General tab and the
workspace instruction field render an `EffectivePromptPreview` — a disclosure showing the composed
prompt exactly as the agent will receive it. Each contributing field carries an inheritance note
("layer 3 of 5 — runs after Workspace + Skills"), which is what the `inherits` prop on
`SettingRow` (`src/workspaces/_components/settings.tsx`) exists for. The ticket detail links to
that preview instead of showing a dead read-only chip.

The Content/Studio stack gets the same treatment with a second profile
(`refine > brief tone > brand voice > channel voice`), and `refine` is persisted per artifact
rather than shared across every generate on the page.

## Rejected alternatives

- **Stage overrides workspace.** Rejected: an empty stage field would then behave categorically
  differently from a filled one, which is an invisible failure mode — the user cannot see that a
  workspace-wide rule stopped applying. The existing hint copy already implies layering, so
  override semantics would also contradict what the UI says today.
- **Layered by default with a per-stage "ignore workspace instruction" checkbox.** Rejected for
  now: it forces the user to learn two mechanisms to predict one prompt. Revisit only if a real
  case appears where a stage must genuinely escape a workspace rule.
- **Leave the semantics as they are and only document them.** Rejected: the composition is
  currently an implementation detail nobody can verify from the screen. Documentation outside the
  product does not help someone editing seven stages.

## Consequences

- `resolveAiLayers()` becomes the single source of truth; any future layer must be added there and
  will automatically appear in the preview.
- The preview makes prompt bugs self-evident (duplicate instructions, contradictory tone), which
  is the main practical payoff.
- Ordering is now a contract: reordering layers later is a breaking behavioural change for every
  configured workspace and needs its own decision.
