---
id: 0044
title: Reasoning first-class — per-stage think-budget (surfaced) + plan-critique gate
status: accepted
date: 2026-07-06
tags: [reasoning, plan-critique, think-budget, expansion-e1]
supersedes: []
depends_on: [0041]
---

# Reasoning first-class

## Context

E1 makes reasoning first-class: (1) a per-stage think-budget (reasoning effort / max-turns / auto-escalate)
and (2) a plan-critique gate — an adversarial pass that attacks the plan before implement.

## Decision

1. **Think-budget is ALREADY surfaced — no new work.** The per-stage `modelCfg` (`StageModelChoice`:
   `model`/`effort` low→max/`maxTurns` + `autoEscalate` + escalation `rules`) is editable in the pipeline
   page today (`src/workspaces/pipeline/page.tsx` — the effort `Segmented` + the turns input + the
   auto-escalate rules). E1 confirms this is the think-budget primitive; it needs no change.

2. **Plan-critique gate = a new adversarial role.** A non-coding `plan-critique` AgentRole (provider
   abstraction, `AiFeature 'plan-critique'`) reads a ticket's plan (the latest `CarryOver` envelope's
   `summary` + `openQuestions`) and attacks it — what's missing / what breaks / which assumption is risky —
   emitting a `WorkspaceSuggestion(type:'plan-critique')` the human folds in before implement. It's
   read-only + advisory (no auto-apply); it runs through the suggestion/feed, **never a second AI window**.
   Triggered by a `plan-critique` control-op (a pipeline can call it after the plan stage, optional gate).

## Rejected alternatives

- **A second AI review window / separate reasoning UI.** Rejected — the user was explicit that reasoning
  flows through the chat/feed, not a parallel window; a `WorkspaceSuggestion` is the existing surface.
- **Auto-apply the critique to the plan.** Rejected — the critique is advisory; the human decides what to
  fold in (B-23 — the AI proposes, the human edits the plan).
- **A new think-budget model/field.** Rejected — `modelCfg` already IS the think-budget; re-modeling it
  would duplicate a working, UI-surfaced primitive.

## Consequences

- `AiFeature` grows (`plan-critique`; + `DEFAULT_ASSIGNMENTS`). No schema change (reuses `WorkspaceSuggestion`
  + `CarryOver`).
- `accept-suggestion` treats `plan-critique` as advisory (like `config-review`) — accepted (status flip)
  without an execute-side write; the human edits the plan.
- Follow-ups: make plan-critique an optional per-pipeline gate (a `WorkspaceTrigger` on plan-stage
  completion); a reasoning-trace view folding the effort/turns into the AI-activity feed.
