---
id: 0075
title: Server-side merge/rollback pushes the target to origin
status: accepted
date: 2026-07-06
tags: [git, mr, forge, depth-program]
supersedes: []
depends_on: [0072, 0021, 0036]
---

# C1 — a merge/revert must reach the forge, not just the local bare clone

## Context

`GAP_ANALYSIS.md` code-side #1: `mergeBranches`/`revertMergeCommit` advance the `target` branch
IN THE LOCAL BARE CLONE, but nothing pushed the result to origin — `pushBranch` existed yet was
never called on the merge/rollback path. So a "merged" MR never actually reached the forge ref.

## Decision

- New `pushRef(workspaceId, gitUrl, token, ref)` in `repoStore` pushes a branch straight from the
  BARE clone to origin (the merge/revert advance `target` there). Token injected transiently via
  `withAuth`, never stored/logged. Bounded **retry/backoff** via a new shared `withRetry` helper
  (`server/util/retry.ts`, reused by C3).
- New `pushMergedTarget(prisma, workspaceId, ticketId, targetBranch)` in `forge.ts` resolves the
  ticket's `project.gitUrl` + the per-project forge token (`resolveForge`) and pushes the target.
  **Non-fatal:** the local merge is authoritative; a `local-only` project (no gitUrl/token) is a
  SKIP, and a push failure is surfaced (`pushError`), never rolled back.
- Wired into `mergeMr` (after a successful merge) and `rollbackMr` (after a successful revert);
  `MergeMrResult` gains `pushed?`/`pushError?` so the client/log can see whether the forge received it.

## Rejected alternatives

- **Push from the ticket worktree (`pushBranch`).** Rejected — the merge result lives on the bare
  repo's `target`, not the ticket's DEV-branch worktree; pushing the worktree branch wouldn't advance
  the forge's target.
- **Fail the merge when the push fails.** Rejected — the merge already landed in the authoritative
  bare clone; rolling it back on a transient network blip would be worse than reporting the failure.

## Consequences

- New `server/util/retry.ts` (bounded retry/backoff, shared with C3). `pushRef` on `repoStore`,
  `pushMergedTarget` on `forge`. Real-git test `tests/integration/mergePush.test.mts` (6/6) proves
  origin's target ref advances to the merge commit + the local-only skip; `tests/unit/retry.test.mts`
  (8/8) covers the retry semantics. `mergeReal` 16/16 unaffected.
- Follow-up: expose `pushed`/`pushError` in the MR view toast (UI) so a push failure is visible in-app.
