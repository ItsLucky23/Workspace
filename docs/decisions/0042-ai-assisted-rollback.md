---
id: 0042
title: AI-assisted rollback — root-cause role → propose→accept forward-revert + tracking ticket
status: accepted
date: 2026-07-06
tags: [rollback, root-cause, ai, propose-accept, forward-revert, expansion-b3]
supersedes: []
depends_on: [0041]
---

# AI-assisted rollback + auto-ticket

## Context

The forward-revert plumbing already exists (`mr-rollback` op → `rollbackMr` → `revertMergeCommit`, a
history-preserving `git revert -m 1`, never a reset — invariant #7). The user wants an AI DRIVER on top:
*"'X doet het niet meer' → AI figures out which changes likely caused it → rolls back → makes a ticket."*
B3 adds that driver as a non-coding role, keeping the human in the loop for the actual revert (B-23).

## Decision

1. **A non-coding `root-cause` AgentRole** (provider abstraction — new `AiFeature 'root-cause'`), mirroring
   the mr-review/interviewer roles. `run`: given a `symptom` + the recent merged MRs (newest first),
   `runAiCompletion('root-cause', …)` ranks the single most-likely culprit + explains why + what to verify.
   It parses `CULPRIT: <mr-number>` / `REASON: …` (pure `parseCulprit`), maps the number to the MR, and
   emits ONE `WorkspaceSuggestion(type:'rollback', patch:{ mrId, symptom, reason })`. It NEVER reverts.

2. **Propose→accept is the write boundary (B-23).** On human accept, the `accept-suggestion` control-op
   dispatches a `type === 'rollback'` branch → `acceptRollback`: it runs the EXISTING `rollbackMr`
   (forward revert, invariant #7) on the ranked MR (best-effort — a no-op without a linked repo), then
   drafts a `DEV-####` tracking ticket pre-filled from the analysis (`labels:['rollback']`, high priority,
   the reason as the description, entering at `unrefined`), firing `ticket.created`. The AI never reverts
   directly; the Conductor does, on consent.

3. **`root-cause` control-op** triggers the role (symptom in the payload), via the `projectAdmin` sync
   route. A `WorkspaceTrigger(on:'deploy.health-fail')` could auto-propose later (follow-up).

## Rejected alternatives

- **Let the AI revert directly.** Rejected — invariant #1/#7: LLMs never write authoritative git/board
  state; a revert is exactly the destructive-ish action that needs a human confirm. Propose→accept keeps it.
- **A hard/destructive rollback (reset/force-push).** Rejected — invariant #7 is forward-only
  (`git revert -m 1`); B3 reuses that plumbing unchanged.
- **No tracking ticket.** Rejected — the user explicitly wants the rollback to "make a ticket" so the
  regression is tracked + re-worked; the ticket is created on accept alongside the revert.

## Consequences

- `AiFeature` grows (`root-cause`; + `DEFAULT_ASSIGNMENTS`). No schema change — reuses `WorkspaceSuggestion`
  + the existing revert plumbing + the ticket-create pattern.
- `accept-suggestion` now dispatches THREE types: `automation` (C-era), `mr-review` (C3), `rollback` (B3).
- Follow-ups: an auto-propose `WorkspaceTrigger` on a deploy/health-fail signal (B1's health-check +
  Environment status are the hook); a per-culprit confidence/diff view in the suggestion UI.
