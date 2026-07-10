---
status: accepted
date: 2026-07-10
tags: [git, multi-project, storage, r3b]
supersedes: []
---

# 0267 — Per-project git storage (R3-b): a workspace holds N independent repos

## Context

`repoStore` keyed every on-disk git artifact by `workspaceId` alone:
`data/workspaces/<ws>/repo.git` + `worktrees/` + `draft.Dockerfile`. A workspace can hold N `Project`
rows (ADR 0035) and the metadata layer (project switcher, webhook routing by repo) supported them, but
the physical storage did not — so **linking or greenfield-ing a 2nd project silently destroyed the
1st**: `cloneRepo` did `rmSync(bare)` before cloning, `initGreenfieldRepo` no-op'd when a bare repo
already existed (2nd project got NO repo), worktrees were cut from the one shared clone, and
`imageBuild`/`dockerfileGen` targeted `findFirst`-by-workspace (always the oldest project). This was the
scan-flagged "R3-b" gap ("2nd repo overwrites the 1st"), deliberately deferred as too cross-cutting.

## Decision

Re-key ALL physical git storage by `(workspaceId, projectId)`:
`data/workspaces/<ws>/projects/<proj>/{repo.git,worktrees/,draft.Dockerfile,merge-wt,revert-wt}`.

- Every repo-touching `repoStore` function takes `projectId` (path helpers `projectDataDir`/
  `bareRepoPath`/`worktreePath`; `cloneRepo`/`initGreenfieldRepo`/`addWorktree`/`repoStatus`/
  `branchHead`/`branchDiff`/`mergeBranches`/`revertMergeCommit`/`listRepoFiles`/`repoHead`/
  `showRepoFile`/`repoManifests`/`listRepoDocs`/`pushBranch`/`pushRef`/`isLinked`).
- `cloneRepo` now `rmSync`-es only ITS OWN project slot; `initGreenfieldRepo` no-ops only when THAT
  project already has a repo — a sibling is never touched.
- Callers source `projectId` from the nearest authoritative place: `Ticket.projectId` (worktree
  activation, stageRunner, editor/preview/refPreview containers, forge push), `MergeRequest.projectId`
  (merge/revert/diff/review), `Environment.projectId` (deploy/demoWatch), the active project
  (snapshot repoStatus, dockerfile draft routes) via the existing `resolveProjectId` resolver.
- `imageBuild`/`dockerfileGen`/`docsGen` resolve the target project (`resolveProjectId`) instead of
  `findFirst`, and the Dockerfile draft moved into the project slot (`dockerfileDraft.draftPath`).
- The container runtime clones from the ticket-project's bare mirror; `launchTicketContainer` gained a
  required `projectId`.
- **Boot migration** `migrateLegacyRepoLayout` relocates a pre-R3-b `data/workspaces/<ws>/repo.git`
  (+ worktrees + draft) into the workspace's FIRST project's slot; idempotent, best-effort, wired in
  `server.ts` after the watchdog starts.

## Rejected alternatives

- **Keep workspaceId keys + a "default project" fallback** — that IS the bug (everything collapses onto
  the first project). Rejected.
- **A `RepoScope` object parameter** — a bigger signature churn than threading one `projectId`; the
  ~21 call sites each already have a ticket/MR/env/active-project in scope.
- **Fix only imageBuild/dockerfileGen scope (COMPLETION K5)** — leaves the repo/worktree layer broken;
  a half-fix is inconsistent (memory-flagged). Done fully instead.

## Consequences

- One workspace can now hold multiple linked/greenfield repos with independent code, worktrees, images
  and Dockerfiles — the foundation for the "develop any codebase, multiple services/repos" product goal.
- `multiRepoR3b.test.mts` (14 asserts) proves two repos don't clobber + the migration; the existing
  greenfield/greenfieldTemplate/mergeReal suites were updated to the per-project layout and stay green.
- RAG currently indexes the resolved (active/first) project; per-project RAG fan-out is a follow-up
  (noted, non-blocking).
