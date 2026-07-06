---
id: 0039
title: Built-in CI + quality gates (green/red blocking merge & promote)
status: accepted
date: 2026-07-06
tags: [ci, quality-gates, merge-gate, promote, expansion-c1]
supersedes: []
depends_on: [0038]
---

# Built-in CI + quality gates

## Context

B2 (ADR 0038) left an explicit TODO: the prod-promote gate needs a green-CI check "once BUILTIN_CI lands".
C1 un-defers `BUILTIN_CI_PIPELINES.md` (a designed-but-deferred spec) to build that: a CI job DAG on the
existing orchestrator where a **red required job blocks merge/promote**. No CI models/parser/runner
existed — only the two gate hooks I left (the `mr-merge` merge point + the prod-promote `ciGreen` TODO).

## Decision

1. **Three models, exactly per BUILTIN_CI §9** — `Pipeline` (a project's `.workspaces/ci.yml` definition,
   one active per project), `PipelineRun` (one execution at a frozen commit; `status` gates), `PipelineJob`
   (one job = a container exec). ⚠ `Pipeline` is UNRELATED to `PipelineStage` (board columns) — same word,
   different concept; the schema carries a loud comment.

2. **"Borrowed, not built" runner** — `runPipeline` reads `.workspaces/ci.yml` at the frozen commit,
   parses it (a DEP-FREE parser — no js-yaml, which has no types + is a transitive-dep boot risk), creates
   the run + job rows, launches ONE job container via `launchTicketContainer` (same image/hardening/egress),
   runs each job's script via `docker exec` in stage order, records a `TicketEvent(type:'ci')` per job, and
   rolls up. No docker ⇒ `canceled` (never ran ⇒ does NOT gate red); no ci.yml ⇒ no run.

3. **The gate — default (A): gate + Admin override.** `ciGateForMr(mr, headSha)`: a red/running/stale run
   for the CURRENT head blocks the `mr-merge` op (a stale-head green does NOT pass — mirrors the approval
   staleness model); no run ⇒ not gated (CI is opt-in). `ciGreenForProject(projectId)` fills the B2
   prod-promote hook. The Admin `Workspace.allowMergeOnRedCI` override unwedges a broken runner ("CI is
   only a killer feature if it actually gates merge; the override prevents a wedged runner from
   hard-blocking a team" — §11). The merge gate slots in `mergeMr` right after the approval gate.

4. **`ci-run` + `ci-allow-red` control-ops** (B-23). `ci-run` triggers a run for a ticket's MR head;
   `ci-allow-red` toggles the Admin override.

## Rejected alternatives

- **js-yaml for the parser.** Rejected — no type declarations (would need a banned `@ts-ignore` or a
  `require`), and a transitive dep can vanish on prune (a hard boot-crash risk). A small dep-free parser for
  the documented subset is safer + deterministic.
- **Gate on "no run" (require CI to have run).** Rejected for V1 — it would wedge merges on any project
  without CI wired; CI is opt-in, so only an ACTUAL red/running run gates.
- **A hard block with no override.** Rejected per §11 — a wedged runner must not hard-block a team; an Admin
  override is the escape hatch (audited by the op).
- **Parallel job scheduler.** Deferred — jobs run sequentially in stage order for C1; a parallel DAG
  scheduler is a later optimization (the `needs` edges are stored for it).

## Consequences

- Schema grows (`Pipeline`/`PipelineRun`/`PipelineJob`; `Workspace.allowMergeOnRedCI`).
- `mergeMr` gains a CI gate (new `reason` values `ci-red`/`ci-running`/`ci-stale` flow to the client toast);
  `promoteEnvironment` prod gate now also requires green CI (fills the B2 TODO).
- C2 (security scanning) adds first-class CI job TYPES on this same runner/DAG; C3 (AI MR-review) is a
  separate propose-only surface. The parallel scheduler, live `/pty` log streaming, and the CI-chip UI are
  named follow-ups.
