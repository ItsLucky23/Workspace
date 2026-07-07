---
title: O-D — "start with AI" auto-activation
status: accepted
date: 2026-07-08
tags: [tickets, orchestration, activation, idea-to-outcome]
---

## Context

To start the AI on a new ticket the user had to create it (lands at `unrefined`, AI off) and then MANUALLY drag
it into the first AI stage. IDEA_TO_OUTCOME O-D removes that step for the common "I want the AI on this now" case.

## Decision

- **`quick-add` gains an optional `startWithAi` flag.** The ticket still ENTERS at `unrefined` (the invariant
  "a user-created ticket always enters at unrefined; no client can place it mid-pipeline" is preserved — the
  Conductor is the writer). Then, when `startWithAi` is set, the Conductor advances it to the FIRST `aiEnabled`
  stage, records a `status-change` event ("auto-started AI at <stage>"), and runs `activateWorktreesForStage`
  (a no-op without a linked repo/Docker, as usual). It returns the ADVANCED row so the realtime delta shows the
  new stage.
- **Wired end to end:** the `workspaces/quickAdd` route threads `startWithAi`; the client `quickAdd` helper +
  the New-ticket form expose a checkbox ("Start with AI right away", i18n ×4).

## Rejected alternatives

- **Create the ticket directly in the AI stage.** Breaks the "enters at unrefined" invariant (a client would be
  placing a ticket mid-pipeline). Creating at unrefined then having the Conductor advance keeps the invariant +
  the single-writer contract.
- **A separate `activate-ticket` op.** A new verb for a flag on an existing op; the flag on quick-add is the
  smaller surface and keeps creation atomic.
- **Auto-activate every ticket.** Many tickets want human triage first; the toggle is opt-in (default off).

## Consequences

- A user can create a ticket and have the AI pipeline pick it up immediately (no manual drag) — completing the
  L2 "conversation/orchestration" phase (O-A/O-B intake → O-C content pipeline → O-D dev auto-start). The
  advance + event are integration-tested; the actual container/agent still needs Docker + a linked repo to do
  work (unchanged). Follow-up: surface the same toggle in the Assistant's create-ticket proposal.
