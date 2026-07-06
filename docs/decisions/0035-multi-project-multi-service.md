---
id: 0035
title: Multi-project / multi-service workspaces (reverses D12 "one project per workspace")
status: accepted
date: 2026-07-06
tags: [multi-project, multi-service, polyrepo, forge, tenancy, schema, expansion-a1]
supersedes: []
reverses: [D12]
---

# Multi-project / multi-service workspaces

## Context

D12 (`features/01_WORKSPACE_SETUP.md` §Resolved / `features/INDEX.md`) locked **one project = one
workspace**: the setup wizard stays single-project, there is no project switcher, and the seed's second
project (`youcomm-api`) is "legacy". That was the right V1 simplification, but it blocks the user's real
case — *"a Java backend separate from an HTML frontend; 2 repos together OR separate, and services instead
of one monorepo."* CLAUDE.md already records the product is "EXPANDING past the old single-* V1", and the
Expansion Program's item **A1** makes multi-project the tent-pole everything else (deploy, environments,
per-project forge) hangs off.

The codebase is already **structurally** multi-project: `Project.@@index([workspaceId])` is NOT unique;
`Ticket`, `PipelineStage`, `MergeRequest` already carry a required `projectId`; `InfoSource`/`RagEntry`/
`StudioBrief` carry an optional `projectId`; `WorkspaceTrigger.match` already has a `projectIds[]` filter;
and the bootstrap helpers (`defaultPipeline`, `starterLibrary`) already take an explicit `projectId`. The
single-project assumption lives almost entirely in **one runtime pattern** — `project.findFirst({ where: {
workspaceId } })` (≈15 callsites) plus three dangerous `updateMany({ where: { workspaceId } })` fan-outs —
and in the **client**, which has no "current project" concept at all.

## Decision

Reverse D12. A workspace holds **N projects** (polyrepo); a project optionally declares **N services**
(a build+deploy unit). Built incrementally per the user's decision (2026-07-06): **(a) polyrepo first,
then (b) services layered on**.

1. **Project is the first-class scoping unit.** Every `project.findFirst({ where: { workspaceId } })`
   becomes an explicit project-scoped resolve (`resolveProject(db, workspaceId, projectId?)` — passed id,
   falling back to the workspace's first project for legacy/unspecified callers). The three
   `updateMany({ where: { workspaceId } })` fan-outs (link-repo gitUrl, imageBuild baseImageRef,
   dockerfileGen dockerfilePath) become project-scoped `update`s — they silently corrupted sibling
   projects once N>1.

2. **`Service` model** (`workspaceId` denormalized for `runInTenant`, `projectId`, `name`, `path`,
   `buildCmd?`, `deployUnit?`, `baseImageRef?`, `devCommand?`). A single-service repo needs no explicit
   Service row (the project root IS the unit); services are additive granularity for monorepos, consumed by
   B1/B2 deploy. `Sprint` gains a required `projectId` (a sprint's board belongs to a project; legacy rows
   backfilled to project #1 via `scripts/backfillMultiProject.ts`).

3. **Snapshot + client gain a "current project".** `buildSnapshot` returns `projects[]` + `activeProjectId`
   and scopes tickets/stages/stageConfigs/sprints/suggestions by it. The client mirrors the existing
   `wantWorkspaceId` playbook with a `wantProjectId` (provider state, no URL change) + a project switcher in
   the shell `TopBar`. Quick-add threads the active `projectId` through the sync payload → the Conductor
   (no more server-side `findFirst`).

4. **Repo storage is keyed by project.** `repoStore` paths move from `data/workspaces/<workspaceId>/…` to a
   project-scoped path so N projects = N independent bare clones/worktrees. A missing clone re-clones
   idempotently (the on-disk repo is a cache, not authoritative state).

5. **Forge stays per-workspace in A1; per-project forge lands in A2.** The incremental boundary: A1 makes
   the repo/git URL resolve per-project (already on `Project.gitUrl`), but the forge token/type stays on
   `Workspace` (works when a workspace's projects share one forge account). A2 (GitHubForge) introduces the
   per-project `ForgeConnection`/`forgeMode` so a workspace can mix GitLab + GitHub projects.

`runInTenant` is unchanged — the **workspace is still the tenant**; project is a scoping axis *within* the
tenant, not a new isolation boundary. B-23 single-writer is preserved: project-create/service-CRUD are
`[control-API]` ops the Conductor executes.

## Rejected alternatives

- **Keep D12 (single project).** Rejected — it structurally cannot express the user's separate-backend/
  frontend case, which is the whole point of this build round.
- **Monorepo-with-services only (option b alone).** Rejected — covers a monorepo's sub-units but NOT the
  "two separate repos" case; the user needs both, hence polyrepo first.
- **Make project a new tenant (project = tenant).** Rejected — it would fracture membership/RBAC/billing
  (genuinely workspace-owned) and every `runInTenant` path. The workspace stays the tenant; project is an
  intra-tenant scope, matching how `Ticket.projectId` already works.
- **Per-project forge in A1.** Deferred to A2 — coupling the forge-provider generalization (GitHub) into the
  project-model reversal would balloon a single item; the incremental split keeps each testable.

## Consequences

- Schema grows (`Service`; `Sprint.projectId`). A backfill script patches legacy sprints; new single-project
  workspaces are unaffected (they simply have one project, selected by default).
- The `project.findFirst` pattern is retired in favor of an explicit resolver — safer, and the fan-out
  `updateMany`s that would corrupt siblings are fixed.
- The client grows a project switcher + `activeProjectId`; the board/pipeline/sources become project-scoped
  views (no structural board change — they render the active project's already-scoped data).
- A2 builds on this: `forgeMode` becomes per-project; deploy (B1/B2) targets a service; CI (C1) runs per
  project. D12 is superseded — do not re-assume single-project in new code.
