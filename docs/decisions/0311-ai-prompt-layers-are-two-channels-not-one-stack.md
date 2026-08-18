---
id: 0311
title: AI prompt layers are two channels, not one stack
status: accepted
date: 2026-08-18
tags: [ai, prompt, ux, correctness, orchestrator]
supersedes: [0308]
---

## Context

ADR 0308 settled a real problem: five free-text fields across two pages steer one Develop-pipeline
agent, and nothing told the user how they combined. Its answer was "strict layering — always
concatenated in this order", rendered in the UI as `layer N of 5` plus a composed-prompt preview.

That answer was written from the UI outward and never checked against
`server/orchestrator/renderStage.ts`. Checking it now, while planning to build a richer hover that
explains all five layers, showed it was wrong in every particular:

1. The fields do **not** form one stack. They travel in two independent channels that reach the
   agent by different routes and live in different places:
   - the **system channel** (`--append-system-prompt`): the stage's system prompt, then the
     carry-over template filled with the previous stage's handoff;
   - the **project channel** (`CLAUDE.md`, written to the container's `/work` volume): the stage's
     task instructions verbatim, then the context documents — which is how the active-skills block
     arrives (`stageRunner` resolves `skillPromptBlock(workspaceId, 'dev')` into a context doc).
2. Therefore `layer 4 of 5` was meaningless, and actively misleading: it implied that layer 3
   constrains layer 4 when the two are not even in the same file.
3. `Workspace.aiInstruction` — layer 1 — **never reached the coding agent at all**. It is applied
   only at the one-shot completion choke-point in `server/ai/registry.ts`, which covers docs
   generation, Dockerfile generation, chat and Studio. The PTY stage-runner renders its own prompt
   and never read it. The op catalog and the settings UI both describe that field as "prepended to
   every AI run".

Point 3 is a defect, not a documentation gap. A confident wrong explanation is worse than none,
because the user acts on it: they write "always use tabs" in the workspace field, the preview shows
it as layer 1 of the agent's prompt, and the agent never saw it.

## Decision

**The UI describes the two channels, and the server delivers what the UI promises.**

1. `src/workspaces/_functions/aiLayers.ts` models `AI_LAYER_ORDER_BY_CHANNEL` — `system` holds
   `workspace → stageSystemPrompt → carryOver`, `project` holds `stageInstructions → skills`. A
   layer's position is **per channel**; there is no global position, and the API no longer offers
   one. `composeEffectivePrompt` is replaced by `composeChannel(layers, channel)`.
2. `EffectivePromptPreview` renders one block per channel — name, what it steers, its layers in
   order, its own composed text. `LayerNote` names the channel: "System prompt · 2 of 3 — after
   Workspace instruction".
3. `workspaceAiPrefix` in `server/ai/registry.ts` is exported and called by `stageRunner`, which
   passes it to `renderStage` as `workspaceInstruction`. It opens the system channel — the same
   position it holds on the one-shot path. One definition, both paths.
4. `tests/unit/aiLayers.test.mts` pins the model against the renderer's source, so a reordering of
   `stageInstructions[]` or of the `claudeMd` template fails the build instead of silently making
   the UI lie again.

## Rejected alternatives

- **Change the server to match ADR 0308 — one concatenated five-layer prompt.** Rejected. The
  two-channel split is deliberate and correct: `CLAUDE.md` is persistent project framing the agent
  re-reads across turns, `--append-system-prompt` is per-turn behavioural framing. Collapsing them
  to make a UI label true would degrade the orchestrator to fix a caption, and it would change agent
  behaviour on every existing pipeline.
- **Keep "layer N of 5" and footnote the channel split.** Rejected: the number is the part users
  read and act on. A footnote does not undo an ordering claim printed next to the field.
- **Document the layer-1 gap on screen instead of fixing the server** ("the workspace instruction
  does not apply to pipeline stages"). Rejected: the field is described as always-on in two places,
  a user reasonably expects the setting labelled "how the AI should work here" to reach the AI that
  writes their code, and the fix is one resolved string passed to an existing renderer.
- **Put the workspace instruction in `CLAUDE.md` instead of the system channel.** Rejected: it is
  behavioural steering, not task content, and `ai/registry.ts` already prefixes it onto the *system*
  prompt everywhere else. Matching that keeps the two paths explainable as one rule.
- **Only fix the preview and skip the structural test.** Rejected — this ADR exists because the
  first version drifted from the server unnoticed. Without the test the same drift is a matter of
  time, and it is invisible exactly when it matters.

## Consequences

- Pipeline agents now receive the workspace-wide AI instruction and the output-language directive.
  This is a **behaviour change on every existing pipeline**: workspaces that already set an
  instruction will see their coding agent follow it where it previously did not. That is the
  documented intent of the field, but it is worth watching on the first runs after deploy.
- `composeEffectivePrompt` no longer exists for the Develop profile. The Content/Studio profile
  (`composeEffectiveContentPrompt`) is a genuinely different, single-channel stack and is unchanged
  — it was verified against `server/studio/generate.ts` when it was written.
- Any sixth layer must be added to `AI_LAYER_ORDER_BY_CHANNEL` **and** to `renderStage.ts`, and the
  structural test will name the mismatch if only one side is edited.
- The general lesson generalises past this feature: an explanation surface must be pinned to the
  code it explains, or it becomes confidently wrong. The same obligation now applies to every
  InfoTip added in the progressive-disclosure work this ADR unblocks.
