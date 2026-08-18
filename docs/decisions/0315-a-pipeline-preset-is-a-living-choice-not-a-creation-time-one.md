---
id: 0315
title: A pipeline preset is a living choice, not a creation-time one
status: accepted
date: 2026-08-18
tags: [pipeline, defaults, onboarding, control-api]
supersedes: []
---

## Context

Two complaints from the owner turned out to be the same defect seen from opposite ends.

**"When I create a new project I get a nice pipeline, but nothing is filled in per stage."**
`createDefaultPipeline` does seed real persona/instructions/carry-over text for the five AI stages, so
a workspace created *today* is not blank. But three paths around it are:

- `stage-create` (the "Add stage" button, and the assistant's own op) wrote `systemPrompt: ''`,
  `customInstructions: ''`, `promptTemplate: '{{summary}}'`, `definitionOfDone: ''` and
  `statuses: []`. A hand-added stage arrived with no persona, no instructions and no board statuses.
- `seedDemoWorkspace` writes `systemPrompt: ''` for every stage.
- Any pipeline seeded before the defaults carried prompt text is still blank in the database, and
  nothing in the product could fill it.

The result is the least legible failure this product has: the pipeline *looks* configured — seven
named columns, model tiers, an AI toggle that says "AI on" — while the agent behind a stage receives
an empty persona and an empty brief. Nothing errors. The run is simply worse than it should be, and
the cause is invisible.

**"We used to be able to pick between several pipeline setups and now we can't."**
That memory is accurate. `Workspace.presetKey` and the three tiers (`simple` / `advanced` /
`professional`) are real, and `CreateWorkspaceForm` asks for one — but only there. `project-create`
and `project-from-template` both called `createDefaultPipeline` with no preset argument, so every
project after the first silently got the full seven-stage flow, and there has never been a way to
change your mind afterwards. A one-time question whose answer cannot be revisited is, in practice, a
hardcoded default with an extra step.

## Decision

The preset becomes a per-project choice that stays available for the life of the project.

1. **Asked per project.** `CreateProjectForm` offers the same three tiers as the workspace form;
   `project-create` and `project-from-template` accept `preset` and fall back to the *workspace's* own
   tier before falling back to `professional`.

2. **One new control-API op, `pipeline-apply-preset`, with two modes.** Both go through the normal
   `_api`/`_sync` → RBAC (`editPipeline`) → enqueue → Conductor path (B-23: the Conductor is the only
   writer).
   - `fill` — non-structural. Writes the canonical blueprint into the fields that are **empty right
     now** and touches nothing else. It never overwrites and never adds or removes a stage.
   - `switch` — structural. Adds the target preset's missing stages, migrates the tickets out of the
     stages it drops, deletes those stages, re-orders, and prunes the now-dangling `visibleStageIds`.
     `fill` runs first in both modes, because a switch that added stages and left the old ones blank
     would only move the same complaint one screen over.

3. **A switch never deletes a stage the user added themselves.** Only the keys the default pipeline
   owns are structural. "Switch preset" means *give me the standard N-stage flow*, not *throw my own
   work away*.

4. **A dropped stage's tickets move to the nearest surviving EARLIER stage** (`fallbackStageKey`).
   Work that had reached Review goes back to Implementation — never forward into a stage it never
   passed. A ticket left pointing at a deleted column is not an error anywhere; it just stops
   appearing on the board, which is the worst shape of data loss because nothing reports it.

5. **The blueprints are served, not copied.** `workspaces/pipelinePresets/v1` returns them from
   `server/bootstrap/defaultPipeline.ts` — the module that actually seeds a pipeline. The UI reads
   them for the preset menu, the switch-impact confirm, and the per-field "use the default"
   affordance.

6. **`stage-create` seeds from the kind blueprint** (and the four base statuses). The kind is asked at
   add-time, in the "Add stage" menu, precisely because it is what decides the blueprint.

## Rejected alternatives

**Only ask at creation time (the smallest change).** Rejected by the owner directly: it leaves every
existing blank stage blank forever, which is the half of the complaint that actually bites.

**Non-destructive only — fill the blanks, never restructure.** This was the recommended option and the
owner explicitly chose against it. The argument for it is that a switch can delete columns that hold
tickets; the argument against it is that the tier then remains a one-time question, which is the
defect. The risk is answered by the guarantees above (custom stages kept, tickets migrated backwards,
an explicit confirm that states the real counts and names first) rather than by refusing the action.

**Copy the blueprints into `src/_data/`.** Rejected: `server/bootstrap/defaultPipeline.ts` is what
seeds a pipeline, so a second copy drifts the moment either side is edited — and the drift is
invisible, because the UI would keep calling its stale text "the default".

**Express it with the existing verbs** (a client-side loop of `stage-create` / `edit-stage` /
`stage-delete`). Rejected: it makes a structural, partially-destructive change non-atomic and
unauditable, it cannot migrate tickets before the delete, and it puts the safety rules in the client.

**Fill silently whenever a stage is empty.** Rejected: writing into a field the user is looking at,
without being asked, is exactly the behaviour that makes people stop trusting a settings page. Every
fill is offered and confirmed; "Save stage" is still the only persist path for a per-field fill.

## Consequences

- The `Add stage` primary button becomes a kind menu. One extra tap; the stage arrives usable.
- A `simple` workspace can grow into `professional` and back. The tiers nest (simple ⊂ advanced ⊂
  professional) and stage keys are stable, so moving up is purely additive and moving down is the only
  lossy direction — which is the one that asks.
- `pipeline-apply-preset` is `destructive: true` in the propose catalog, so the assistant must ask
  before running the `switch` half.
- `docs/AI_PROJECT_INDEX.md` gains two routes: `workspaces/pipelinePresets/v1` (read) and
  `workspaces/pipelinePreset/v1` (write).
