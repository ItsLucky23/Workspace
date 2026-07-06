---
id: 0041
title: AI MR-review pass (propose→accept, never writes/approves)
status: accepted
date: 2026-07-06
tags: [mr-review, ai, propose-accept, rag, b-23, expansion-c3]
supersedes: []
depends_on: [0039]
---

# AI MR-review pass

## Context

`BUILTIN_MR_REVIEW.md` designs an AI reviewer but marks it deferred, with a blanket "the AI never authors a
review comment" posture. The SHIPPED schema, however, already widened `ReviewComment` for exactly this
feature — `authorKind: 'user' | 'ai'` + optional `authorId`. C3 is the white-space item that fills it: an
AI that reads an MR diff (RAG-grounded) and posts line-anchored findings — via propose→accept, never
writing or approving directly.

## Decision

1. **A non-coding `mr-review` AgentRole** (provider abstraction, ADR 0007 — new `AiFeature 'mr-review'`),
   mirroring the interviewer role. `run`: load the MR + `branchDiff` → `parseUnifiedDiff`, `retrieve()`
   the shared RAG for grounding, `runAiCompletion('mr-review', …)`, parse findings, and
   **validate every finding's line anchor against the real diff** (drop hallucinated line numbers). It
   emits ONE `WorkspaceSuggestion(type:'mr-review')` carrying `{ mrId, findings[] }` in its `patch`.

2. **Propose→accept is the write boundary (B-23).** The AI NEVER writes a comment. On human accept, the
   `accept-suggestion` control-op dispatches a new `type === 'mr-review'` branch → the Conductor posts each
   finding as a real `ReviewComment(authorKind:'ai')` (no `authorId`). The AI never approves or merges —
   `mr-approve`/`mr-merge` stay human-only + approval-gated. This keeps the B-23 invariant intact at the
   write boundary while enabling an AI author on the comment.

3. **Reuses existing surfaces.** The proposal appears in the existing suggestions UI (human accepts); the
   posted AI comments render in the existing MR review panel (which already handles `authorKind:'ai'`). No
   new client UI — the `mr-review` op (via the `mrAction` sync route) triggers a review; a
   `WorkspaceTrigger(action:'invoke-agent-role', role:'mr-review')` can auto-trigger on an MR event.

## Rejected alternatives

- **Let the AI post the comment directly.** Rejected — violates B-23 (LLMs never write authoritative
  state). The propose→accept bridge keeps a human in the loop for every write.
- **A dedicated AiReview model.** Rejected — the finding proposal fits `WorkspaceSuggestion.patch` (JSON);
  the posted comment is a normal `ReviewComment`. No new model needed (the schema was pre-widened).
- **Skip line-anchor validation.** Rejected — a model can cite a line that isn't in the diff; anchoring
  findings to real changed lines (via the parsed `MrDiff.newNo`) keeps comments trustworthy.

## Consequences

- `AiFeature` grows (`mr-review`; + its `DEFAULT_ASSIGNMENTS` entry). No schema change (already supported).
- `accept-suggestion` now dispatches a second type beyond `automation`.
- Also nudges RAG-consumption breadth (E2) — the reviewer grounds on `retrieve()`.
- Follow-ups: an auto-trigger `WorkspaceTrigger` on `mr.updated` (thin automation wiring); a per-finding
  accept/dismiss UI (currently the whole suggestion is accepted at once).
