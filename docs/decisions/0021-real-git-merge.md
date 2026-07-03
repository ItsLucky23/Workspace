---
id: 0021
title: Real git-merge for the built-in MR review (approval-gated, conflict-safe, revertible)
status: accepted
date: 2026-07-03
tags: [workspaces, mr-review, git, merge, approvals]
supersedes: []
---

# 0021 — Real git-merge (completes the built-in MR review)

## Context

Goal-item #9. The built-in MR review (ADR 0018) could open/diff/comment/approve an MR, but
`mergeMr` was a **status flip only** — it set `status='merged'` without touching git. That's a lie:
the target branch never actually received the work, and there was no rollback. The user wants a
REAL merge (branch → target in the bare clone), gated on **≥1 approval**, conflict-safe, and
revertible.

## Decision

- **`repoStore.mergeBranches(workspaceId, target, source, strategy)`** does a real merge in the
  per-workspace **bare clone** via a THROWAWAY merge-worktree (never a long-lived checkout): add a
  worktree on `target`, `git merge` (`--no-ff` / `--squash` / `--ff-only` per the MR's strategy),
  and on success the target ref advances. On conflict the merge is **aborted** (target untouched)
  and the conflicting files are returned. `revertMergeCommit` rolls a merge back with a
  history-preserving **git-revert** (auto `-m 1` for a real merge commit, plain revert for a
  squash), never a destructive reset.
- **Serial by the existing lease.** Merges run inside the Conductor's op switch, which already holds
  the per-workspace write-lease (ADR 0015), so two merges can't race the same target. No new lock.
- **`mergeMr` enforces the approval gate:** it requires ≥1 approval whose `headSha` equals the MR's
  current head (a *stale* approval — cast before the branch advanced — does not count). Only then
  does it call `mergeBranches`, record the merge commit sha (`MergeRequest.mergedSha`, new field)
  for rollback, and flip status. On conflict it flips status to `conflict` and returns the files.
- **`mr-rollback` control-op** (+ RBAC `workTickets`, + the `mrAction` route's action map) reverts a
  merged MR and reopens it for re-review — mirroring the existing mr-* ops, no new *verb* on the
  frozen AI channel.
- **UI:** the Merge button is disabled until a fresh approval exists (with a tooltip); a conflict
  shows a `conflict` status + a "Retry merge"; a merged MR shows a **Revert** button; the transient
  merge/rollback outcome (no-approval / conflict + files) is toasted via a non-persisted
  `actionResult` carried on the returned view. i18n en/nl/de/fr.

Conflict → AI `--resume` auto-resolution (feeding the conflicting hunks back to a resume turn) is a
follow-up slice: it needs conflict-context injection into `renderStage`. #9 ships the conflict-SAFE
path (detect + abort + surface + `conflict` status); the auto-resolve turn is deliberately deferred
(flagged, not silently dropped — Rule 3b).

## Rejected alternatives

- **Keep the status-flip.** It never merged anything and couldn't roll back — the whole point.
- **Merge in the ticket's long-lived worktree/container.** That risks the AI's in-progress checkout
  and couples merging to a running container. A throwaway worktree off the bare clone is isolated
  and cheap.
- **`git reset` to roll back.** Destroys history and is unsafe on a shared branch. `git revert` is
  the correct, auditable inverse.
- **Merge without the approval gate / with any approval (incl. stale).** The user's invariant is
  explicit: ≥1 approval, and a stale approval (branch moved since) must not authorise a merge.

## Consequences

- The target branch really receives the work; the MR record is now backed by git.
- A bad merge is revertible; a conflict is safe (target untouched) and visible.
- Verified: `mergeReal.test.mts` (16/16) against a real bare repo — clean merge advances the
  target, revert removes it, a genuine conflict aborts with the files reported + target untouched,
  and the approval gate blocks then admits. Full suite 23/23. Panel renders cleanly (browser).
