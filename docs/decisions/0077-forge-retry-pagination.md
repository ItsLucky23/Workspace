---
id: 0077
title: Forge issue-sync paginates + retries; git push retries
status: accepted
date: 2026-07-06
tags: [forge, git, reliability, pagination, depth-program]
supersedes: []
depends_on: [0072, 0075, 0036]
---

# C3 — no silent >100-issue drop; transient blips retried

## Context

`GAP_ANALYSIS.md` code-side #4: `fetchGitlabIssues`/`fetchGithubIssues` fetched a single
`per_page=100` page — a project with >100 open issues silently lost the rest. Network ops had no
retry/backoff (a transient blip dropped a git push or a sync).

## Decision

- **Pagination:** a pure `accumulatePages(fetchPage, {perPage, maxPages})` follows `page=1..` until a
  short page or a safety cap (`MAX_ISSUE_PAGES=20` → 2000 issues). Hitting the cap sets `capped` and
  the caller `console.warn`s it — **never a silent truncation**. Both GitLab + GitHub sync use it.
- **Retry:** each page fetch + `pushBranch` (push-on-approval) run through `withRetry` (ADR 0075).
  `isTransientForgeError` retries only 5xx/429/network — a 4xx (bad token / not-found) fails fast.
- Both helpers exported for a network-free unit test.

## Rejected alternatives

- **Unbounded pagination.** Rejected — a runaway/misbehaving forge could loop forever; a logged cap
  is safer and still non-silent.
- **Retry every error.** Rejected — retrying a 401/404 wastes time and can hammer the forge; only
  transient classes are retried.

## Consequences

- `accumulatePages` + `isTransientForgeError` in `gitlabSync.ts`; `pushBranch` gains retry.
  `tests/unit/forgePagination.test.mts` (14/14) covers short-page stop, multi-page concat (the
  >100 fix), cap reporting, and the transient classifier. Live multi-page sync against a real forge
  is part of the deferred post-keys e2e.
