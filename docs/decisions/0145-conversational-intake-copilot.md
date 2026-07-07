---
title: L2 O-A/O-B — the conversational front door (Assistant creates + decomposes, not just reshuffles)
status: accepted
date: 2026-07-08
tags: [assistant, intake, content, tickets, single-writer, idea-to-outcome]
---

## Context

The honest audit (`memory/workspaces-honest-gap-audit`) found the biggest gap to "just chat + approve → it
happens": the Workspace-AI could only PROPOSE 3 board ops (bulk-move / assign / add-comment) — it could not
CREATE anything, and content was a wall of manual generate-buttons with no conversational entry. There was no
"make me X" front door. IDEA_TO_OUTCOME_PROGRAM Fase L2 (O-A/O-B) closes this, first, because it unblocks the
whole "idea → outcome" feel for both the dev and content sides.

## Decision

- **O-B — the Assistant can now propose CREATE ops.** `ChatProposal.op` gains `create-ticket` and
  `create-content`. On accept they route to the EXISTING verbs — `create-ticket → workspaces/quickAdd`,
  `create-content → workspaces/contentControl` (`content-from-brief`). NO new verbs, NO new writers: the AI
  still only proposes; the user accepts; the Conductor writes (B-23 single-writer + the frozen structured-channel
  surface both intact).
- **O-A — the IntakeCopilot: multi-step PLANS.** A big idea ("build a todo app with login") decomposes into an
  ordered `ChatPlan` of steps (each a `ChatProposal`), rendered as ONE approvable card; approving dispatches every
  step in order through the same single-step dispatch path. This is the distinct value over O-B's single op.
- **Validation stays a hard guard.** `validateChatAction` / `validatePlan` (exported, unit-tested) drop any step
  that doesn't independently validate; a plan needs ≥2 surviving steps (a 1-step "plan" is just a proposal).

## Rejected alternatives

- **A brand-new `intake`/`copilot` control verb.** Violates the frozen-verb invariant (no new verbs to close a
  gap). Re-expressing intake via existing verbs (quick-add / content-from-brief) + the propose→accept→Conductor
  path is the contract-honoring way. (`copilot-propose` / ADR 0070 remains the separate UI-directive copilot.)
- **Let the Assistant execute directly when "obviously safe".** Breaks single-writer (B-23). Every create still
  goes through accept → the Conductor.
- **Auto-run the whole content pipeline on create-content now.** Deferred to O-C (`content-run-pipeline`); O-A
  creates the piece, O-C will chain the generation. Keeps this increment shippable + tested.

## Consequences

- A user can now type "maak een 60s video over onze launch" or "bouw een todo-app met login" into the Assistant
  and get a real content piece / a set of tickets created — the conversational front door the pitch implied.
  Everything remains propose→accept→Conductor, so the invariants hold. The generated apiTypes carry the new
  ChatResult shape. Next: O-C (content pipeline orchestration) + O-D (auto-activation), then Fase V (real video).
  UI (the Assistant plan card) is logic-tested; a live browser pass is batched with the other UI phases.
