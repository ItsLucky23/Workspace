---
id: 0009
title: Register-flow AI operations — direct _api, draft-then-review, pure-context prompting
status: accepted
date: 2026-07-02
tags: [ai, register-flow, dockerfile, docs, security]
supersedes: []
---

## Context

Register-flow steps C (AI `.workspaces/Dockerfile`) and D (AI docs) are the first AI
*write-ish* operations — each drives a slow `claude` turn (~30-120s) that produces a
project artifact. Three cross-cutting choices settled while building them (phases 6a/6b).

## Decision

- **AI operations are direct `_api` routes, NOT Conductor control-ops.** `generateDockerfile`
  / `generateProjectDoc` / `aiChat` each run a multi-second-to-minute AI turn. The Conductor
  is the single SERIAL writer for authoritative state; routing a 2-minute turn through it
  would stall every other write. So AI ops call the provider layer directly from an `_api`
  handler (capability-gated), and only their *result* — if it mutates state — goes through a
  normal control-op (e.g. the Workspace-AI chat's accepted proposal dispatches `bulk-move`).
- **Generated artifacts are a reviewable DRAFT, never auto-applied.** The Dockerfile is
  written to `data/workspaces/<id>/draft.Dockerfile` and validated to extend the L1 base
  (`FROM workspaces/base` only, Q-CT-DOCKERFILE-TRUST) — but NOT built or committed. The user
  reviews (Monaco slice) before it becomes the repo's `.workspaces/Dockerfile` and an L2
  image. Docs land as `generated` InfoSources the user can see + toggle, not silent truth.
- **Pure-context prompting.** The `claude-cli` provider runs in a scratch cwd (not a repo
  checkout), so AI-gen prompts pass the repo content inline (manifests + file tree) and
  explicitly forbid filesystem/tool access ("use ONLY the provided files"). See lesson 0008.

## Rejected alternatives

- **Route AI ops through the Conductor** — uniform with state writes, but a slow turn holds
  the serial lease and stalls the realtime board (the same off-chain reasoning as ADR 0008's
  container provisioning). Direct `_api` + a capability gate is the fit.
- **Auto-build/commit the generated Dockerfile** — fastest, but an arbitrary `FROM`/`RUN` is
  a supply-chain surface against the daemon holding the subscription token (07b §2). Draft +
  human review + base-image validation is the trust posture (Q-CT-DOCKERFILE-TRUST, Admin-gated).
- **Run the provider inside a repo checkout so the agent's tools read real files** — richer
  context, but needs a worktree/volume per AI call (heavier) and re-introduces the
  filesystem-vs-prompt confusion. Deferred; pure-context prompting is the V1 answer.

## Consequences

- Every AI-gen feature is a thin `_api` route over `runAiCompletion(<feature>)` + a validate
  + persist-as-draft step; adding one (conflict-resolve, test-gen, …) follows the same shape.
- The L2 `docker build` of the draft + the Monaco review UI + committing the file into the
  repo are later slices (P2 for L2 per 07b §1.2). The draft + validation exist now.
- Because AI ops don't touch the Conductor, they don't get its realtime delta broadcast — a
  generated doc/Dockerfile surfaces on the next snapshot (or an explicit UI refresh), not via
  a live merge. Acceptable: these are rare, user-initiated, per-user operations.
