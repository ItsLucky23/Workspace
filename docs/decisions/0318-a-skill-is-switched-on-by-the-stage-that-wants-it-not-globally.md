---
title: A skill is switched on by the stage that wants it, not globally
status: accepted
date: 2026-08-20
tags: [ai, skills, pipeline, ux]
supersedes: []
---

## Context

A `Skill` with `skillType: 'instruction'` is a reusable block of text injected into AI runs. Until
today it had **two** independent switches:

- `Skill.enabled` — a boolean toggled from a card on the workspace AI page.
- `Skill.applyPoints` — a list of run-groups (`content`, `dev`, `chat`, …, or `all`) it applies to.

`resolveSkillsFor` required both: enabled **and** a matching apply point. That produced a state a user
cannot reason about — a skill showing "on" that contributes nothing, because the run they were looking
at was not in its scope. It also produced the opposite: an empty apply-point list was treated as
"everywhere", so switching a skill on with no scope silently added it to every AI task in the
workspace.

Separately, every dev-pipeline stage resolved the same set (`skillPromptBlock(workspaceId, 'dev')`).
A plan stage and a review stage want different instructions, and there was no way to say so — the only
control was workspace-wide.

The owner's ask: *"ik wil dat je de skills nooit aan hoeft te zetten maar dat je dus bij de pipeline
stages de skills kan aan of uit zetten."*

## Decision

**Apply points are the only global switch, and a pipeline stage picks its own skills by id.**

1. `Skill.enabled` is retired for instruction skills. It survives in the schema because *capability*
   skills (`skillType: 'capability'`, toggled from the Sources page) genuinely use it.
2. `applyPoints` now means exactly what it says, with no second gate: `['all']` = every AI run; a list
   = those groups; **empty = nowhere automatic**. Empty is not "off" — the skill still runs wherever a
   stage picked it. Builtins seed empty, so a fresh workspace runs no skill it did not ask for.
3. `PipelineStage.aiSkillIds` holds the skills that stage runs with. `stageRunner` renders
   `stageSkillBlock(workspaceId, cfg.aiSkillIds)` instead of resolving by apply point.
4. A one-time migration folds the old flag into apply points so no workspace changes what it runs:
   `enabled:false` → `applyPoints: []`; `enabled:true` with an empty list → `['all']`; otherwise
   unchanged.
5. The `ai-skill-toggle` control-op is **removed** (catalog, RBAC, Conductor, chat dispatch, client
   action, effect matrix). It would have flipped a flag nothing reads. Scoping is expressed through
   `ai-skill-save` with `applyPoints`, which the assistant already had.

Alongside, the skills UI became one editor: the full instruction text in a tall monospace field, name
editable, examples and scope in the same form, and "add" opening that same editor rather than a
second, poorer one.

## Rejected alternatives

- **Keep `enabled` and add the per-stage list.** Three switches for one skill. The state where a stage
  picked a disabled skill has no defensible answer — honour it and the toggle is a lie, ignore it and
  the stage picker is a lie.
- **Repurpose `ai-skill-toggle` to mean "add/remove for the current stage".** The stage's skill list is
  part of its config and already persists through `save-stage-config`; a second write path to the same
  field is how the two-switch problem started.
- **Make the stage list additive on top of the apply-point resolution.** Then a stage could add but
  never remove, and "uit zetten voor deze stage" — the literal ask — would be unexpressible.
- **Drop apply points and make every consumer pick skills by id.** Correct in the pipeline, wrong
  everywhere else: Content, Studio, Documents and Chat have no per-run config screen to pick them in.

## Consequences

- A skill can now be scoped to nothing and still be useful — the state the old model could not express.
- The stage config is the single place where "which instructions does this agent run with" is answered,
  which is also where the answer is actionable.
- `Skill.enabled` stays in the schema with a narrowed meaning (capability skills only). Anything reading
  it for an instruction skill is a bug; `server/ai/skills.ts` no longer does.
- The assistant lost an op. It can still scope a skill (`ai-skill-save`), and its workspace-state text
  now reports each skill's scope instead of a meaningless on/off.
- Removing the op regenerated `src/_sockets/apiTypes.generated.ts`.
