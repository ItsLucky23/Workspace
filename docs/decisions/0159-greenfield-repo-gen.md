---
title: G1 — greenfield: real repo + seed file-tree generation
status: accepted
date: 2026-07-08
tags: [greenfield, scaffold, git, repo, idea-to-outcome]
---

## Context

`project-from-template` created a Project row + seeded convention docs + a default pipeline, but never made a
REPO — `gitlabPath:''`, no `gitUrl`, no bare clone. So `isLinked` stayed false, the runtime couldn't cut a
worktree, and no container/code followed. A "greenfield" project was a shell with nothing to edit. G1 makes it
a real, runnable starting point with no external forge.

## Decision

- **Templates carry a seed `files` tree** (`StarterFile[]`) — a minimal but runnable skeleton per stack
  (package.json + entry + config + README + .gitignore for node-api / react-vite; requirements.txt + app/main
  .py for fastapi). Not a full app: the starting point the impl-stage agent fleshes out.
- **`initGreenfieldRepo(workspaceId, files)` in repoStore** writes the tree into a temp checkout, `git init -b
  main` + a self-contained identity + commit, then `git clone --bare` into the durable per-workspace
  `repo.git`. `isLinked` flips true → the existing worktree/container path just works (container → code). It
  is a **no-op when a repo already exists** (never clobber a linked repo), and self-contained (no external
  forge, no network).
- **`project-from-template` calls it best-effort** and stamps the project `gitUrl: greenfield://<workspaceId>`
  when it linked, so the UI/status treats it as a linked project. A git failure logs + leaves the project
  unlinked (the row + pipeline still exist).

## Rejected alternatives

- **Spin up a built-in git server / require an external forge (GitHub/GitLab) for greenfield.** The runtime
  already cuts worktrees from the local bare `repo.git`; a local `git init --bare` + a seed commit is all that
  is needed for container → code. A forge is an optional publish target, not a prerequisite to start coding.
- **Seed only docs (the pre-G1 behaviour) and let the agent create every file.** An empty repo gives the agent
  nothing to run or extend and no `package.json` for image/dep inference; a minimal runnable skeleton is a far
  better starting point and makes `isLinked`/preview meaningful immediately.
- **A per-project repo (multi-repo per workspace).** The store is one bare `repo.git` per workspace by design
  (GIT_STRATEGY §0); greenfield reuses it. Multiple greenfield projects in one workspace share the repo (the
  no-op guard) — per-project repos are a separate, larger change (tracked elsewhere), not required for G1.

## Consequences

- "From an idea → runnable software" is real: a greenfield project now yields a git repo with a committed,
  runnable seed tree on `main`, `isLinked` true, ready for a worktree + container + the impl-stage agent — with
  no external forge. Proven E2E against real git (7/7): the op creates the repo, `main` carries the seed
  package.json + entry file, and `listRepoFiles` indexes the tree. The welcome/template-wizard UI (G2) is the
  front door onto this op.
