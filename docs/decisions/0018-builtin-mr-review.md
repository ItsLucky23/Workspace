---
name: builtin-mr-review
title: Built-in merge-request review — diff + line-anchored threads + stale-on-new-head approvals + merge
status: accepted
date: 2026-07-03
deciders: [ItsLucky23]
tags: [mr, review, git, engine, frontend]
supersedes: []
relates: [0013]
---

## Context

V1 "merge" was just push-on-approval → a GitLab MR URL (forge-side review). BUILTIN_MR_REVIEW specs a
first-class in-app review surface: a diff, line-anchored discussion threads, approvals that invalidate
when the branch advances, and a merge action. This ADR records building that (schema + backend +
frontend), so a workspace can review + merge inside Workspaces without bouncing to the forge.

## Decision

- **Schema (ADR 0017 sibling migration)**: `MergeRequest` (per-ticket, per-workspace `number`,
  source/target branch, `headSha`, status, `externalUrl` when forge-backed) + `ReviewThread`
  (line-anchored `filePath`+`line`, or MR-level) + `ReviewComment` (user or `ai`) + `Approval`
  (bound to the head it was granted at). All tenant-scoped.
- **Diff** (`server/mr/diff.ts`): a bounded unified-diff parser turning `git diff target...source`
  (read from the bare clone, no checkout — `repoStore.branchDiff`) into per-file, line-numbered lines
  the frontend renders and threads anchor to.
- **Service** (`server/mr/service.ts`): `createMr` (idempotent open/refresh from a ticket's branch),
  `addReviewComment` (creates the thread if needed), `approveMr`, `resolveThread`, `mergeMr`, and
  `mrForTicket` (the full view: fresh diff + threads + approvals with **staleness computed against the
  current head**).
- **Ops**: one `mrAction` `_sync` route (`action` selects `mr-create|comment|approve|merge|resolve`),
  each returning the fresh MR view; `workTickets` cap. `mr-create` doubles as the tab's load+refresh.

## Rejected alternatives

- **Forge-only review (keep V1).** Rejected per the goal — the review should live where the work does;
  bouncing to GitLab for every review breaks the single-surface product.
- **Compute the diff in a worktree checkout.** Rejected — `git diff target...source` from the bare
  clone needs no checkout and no extra disk; only an actual merge needs a worktree (a follow-up).
- **A real in-repo merge now.** Deferred — `mergeMr` records the decision (status=merged); the actual
  ref-advancing merge belongs to the forge (external MR) or a later bare-repo merge worktree. The
  review value (diff + threads + approvals) is fully delivered.
- **Five separate routes.** Rejected — one `mrAction` route with an `action` discriminator is far less
  boilerplate for a set of ops that all return the same MR view.

## Consequences

- A ticket's branch is reviewable in-app: diff, comment on any line, approve, merge — proven end to
  end by `scripts/spike/mrSpike.mts` (parser; comment→thread; approve→approval; approval goes STALE
  when the head advances; resolve).
- Approvals are honest about staleness (re-review required after new commits).
- Follow-ups: the actual bare-repo merge (worktree), merge strategies (squash/ff) beyond the record,
  approval RULES (required count / RBAC-tied), and an AI reviewer posting `authorKind:'ai'` comments.
