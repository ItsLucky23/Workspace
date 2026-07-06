---
id: 0036
title: GitHubForge + per-project forge connection (un-defer)
status: accepted
date: 2026-07-06
tags: [forge, github, gitlab, multi-project, webhooks, expansion-a2]
supersedes: []
depends_on: [0035]
---

# GitHubForge + per-project forge connection

## Context

`FORGE_ABSTRACTION.md` designs a 6-capability `ForgeProvider` seam (boardSync / repoHosting /
mergeRequests / ci / webhooks / auth) across GitLab / GitHub / Builtin, but only **GitLab is built**, and
the live implementation is lighter than the doc's design: there is NO `ForgeProvider` interface in code —
forge state lives on `Workspace` (`forgeType` = `'gitlab' | 'github'`, `gitlabUrl`, `gitlabTokenEnc`,
`gitConfig`), resolved inline in `server/git/forge.ts` (`asForgeType`, `forgeBase`). A two-provider MR
request-shaper (`server/git/forgeProvider.ts`, `openForgeMergeRequest`) already branches `gitlab` vs
`github` for the merge-request/PR call; issue ingestion (`gitlabSync.ts`) and webhook parsing
(`webhookIngest.ts`) are GitLab-only. Forge is **per-workspace**, and the on-disk bare clone
(`repoStore.ts`) is keyed by `workspaceId`.

The Expansion Program item **A2** un-defers GitHub, and ADR 0035 (A1) made a workspace hold N projects.
So the forge must become **per-project** (a workspace can mix a GitLab backend project and a GitHub
frontend project), and the physical repo — deferred by A1 — must be re-keyed per project.

## Decision

1. **Per-project `ForgeConnection`** (`mode` `'gitlab' | 'github'`, `baseUrl`, `repoPath`, `tokenEnc`,
   `webhookSecret`, `status`; `@@unique([projectId])`). This adapts the doc's `ForgeConnection` (which was
   per-workspace) to per-project — **forced by A1**; the builtin-mode fields (`builtinRepoRef`, `ciRunner`)
   are omitted (built-in git hosting is a separate build target). Per `Q-FORGE-DATAMODEL`, the existing
   GitLab columns are **untouched**: when a project has no `ForgeConnection`, forge resolution falls back to
   the workspace GitLab fields (zero migration / zero regression for existing single-forge workspaces).

2. **`GitHubForge` alongside `GitLabForge`.** Build the GitHub realizations of the capabilities the product
   uses: mergeRequests (PR create + status — the request-shaper already branches `github`), boardSync
   (GitHub Issues → tickets, mirroring `gitlabSync`), webhooks (parse `X-GitHub-Event` PR/issue payloads in
   `webhookIngest`). repoHosting is already generic (clone by `gitUrl` + token, host-aware `withAuth`).

3. **Forge resolution becomes per-project.** `forge.ts` / `gitlabSync.ts` / `webhookIngest.ts` resolve the
   project's `ForgeConnection` (falling back to the workspace GitLab fields), so the right provider + token +
   repoPath is used for the right project. A `forgeMode` is per-project, not per-workspace.

4. **The physical `repoStore` re-key by project is DEFERRED to B1** (not done in A2). Re-keying the
   on-disk bare clone + worktrees from `workspaceId` to `projectId` touches 10 callers including the whole
   container runtime / image-build / editor-profile layer — which B1 (environments/deploy) reworks anyway,
   so re-keying there is lower-churn. In A2 the forge **config** (mode/token/repoPath), **issue ingestion**,
   **webhooks**, and the **PR API** are per-project; the on-disk clone stays workspace-keyed. Consequence:
   GitHub forge works end-to-end for a GitHub-backed project (single, or as the active project); physically
   isolating TWO different repos cloned side-by-side in one workspace waits for the B1 re-key.

5. **Single-forge-per-project, immutable in this round.** No mixed source-of-truth within a project; no
   mode-switching after connect (a future `forge-migrate` op). Matches `Q-FORGE-SOT-MIXED` /
   `Q-FORGE-MODE-SWITCH`.

The settings surface gains a **per-project forge picker** (GitLab / GitHub) + token + Verify, generalizing
the workspace GitLab tab. B-23 preserved: forge writes are `[control-API]` ops the Conductor executes.

## Rejected alternatives

- **Forge fields directly on `Project`** (no `ForgeConnection` row) — rejected: the doc models a dedicated
  connection row for the generalized multi-mode future (incl. builtin); a focused row keeps the GitLab
  columns clean as the fallback and matches the designed contract.
- **Keep forge per-workspace** — rejected: it cannot express a workspace with a GitLab backend + GitHub
  frontend, which is exactly the multi-project case A1 unlocked.
- **Full 6-cap `ForgeProvider` OO interface now** — deferred: the live code is a set of per-cap functions +
  a request-shaper; introducing the full interface is a larger refactor than A2 needs. GitHub is added as
  the parallel realization of the functions that exist, keeping the change surface proportional (Rule 7b).

## Consequences

- Schema grows (`ForgeConnection`). GitLab columns stay as the fallback — existing workspaces are unaffected.
- GitHub issue-ingestion (`mapGithubIssues` + `fetchGithubIssues`) + provider-aware `postIssueComment` +
  GitHub `X-Hub-Signature-256` HMAC webhook verification join the GitLab paths; the MR/PR shaper is shared.
- The physical per-project repo clone re-key is deferred to B1 (decision #4) — A2 makes forge config/API
  per-project, not the on-disk clone.
- Deploy (B1/B2), CI (C1), and AI-review (C3) stay forge-agnostic — they target the resolved connection.
- Builds on ADR 0035; `forgeMode` is now per-project.
