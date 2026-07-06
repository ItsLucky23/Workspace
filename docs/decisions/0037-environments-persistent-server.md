---
id: 0037
title: Persistent environments (dev/staging/prod) + deploy control-op
status: accepted
date: 2026-07-06
tags: [deploy, environments, containers, proxy, multi-project, expansion-b1]
supersedes: []
depends_on: [0035]
---

# Persistent environments + the first "run the app" beyond preview

## Context

Everything that runs a user's app today is EPHEMERAL: the 30-min ticket preview (`previewSession.ts`)
launches a per-ticket container behind `<branch-slug>.<domain>` and is reaped with the ticket. There is no
long-running deployment — nothing that serves a project's app at a stable URL after Review. B1 adds the
first persistent run target: `dev` / `staging` / `prod` environments, each a long-running container at a
STABLE route, reusing the existing substrate (`launchTicketContainer` + the proxy abstraction +
`imageBuild`'s `Project.baseImageRef`). No `Environment`/`Deployment` model existed (schema §18 even bars
adding preview-deploy models in V1) — this is the first.

## Decision

1. **`Environment` model** (`workspaceId`, `projectId`, `serviceId?`, `kind`, `route`, `imageRef?`,
   `containerName?`, `branch?`, `status`, `healthUrl?`, `lastError?`, `lastDeployedAt?`). One environment
   per (project, service, kind); `serviceId` null = the project root (single-service repo). Uniqueness is
   enforced in the deploy op (Mongo nullable-unique is unreliable), not a `@@unique`.

2. **A persistent env is `previewSession` minus the TTL, plus a stable route + readiness.** `deployEnvironment`
   launches a container via `launchTicketContainer` with a synthetic stable key `env-<envId>` cloning the
   DEPLOY branch (gitConfig.targetBranch, default `main`) rather than a ticket branch, runs the serve command
   (`Service.devCommand ?? Project.devCommand ?? 'npm run dev'`), waits for readiness (new
   `waitForContainerReady` probe — none existed), then flips the STABLE route (`envRoute`,
   `<kind>-<service>.<workspace>.<domain>`) to it. The route is only flipped AFTER readiness so a broken
   deploy never blackholes the live URL.

3. **Fixed `dev → staging → prod` ladder (§2.4).** prod gating (approval + green CI + health) lands in B2/C1;
   B1 builds the deploy/teardown machinery + the ladder. `env-deploy` / `env-teardown` are `[control-API]`
   ops the Conductor executes (B-23); the leader provisions (the action chain already holds the workspace
   lease).

4. **Boot self-heal.** `reassertEnvironmentRoutes` re-adds the proxy route for every `live` env whose
   container is still up — the boot reconcile prunes routes without a running container but never RE-ADDS
   one, so a proxy restart would otherwise silently drop a stable URL.

## Rejected alternatives

- **Run the built image directly (no branch clone).** Rejected for B1: the pipeline image (from the Dockerfile
  draft) does not itself contain built app source unless the Dockerfile builds it; the preview model
  (clone branch + run serve command) is the proven path that actually serves. A build-into-the-image flow is
  a B2 refinement.
- **A new `launchEnvContainer` primitive.** Deferred: reusing `launchTicketContainer` with a synthetic
  `env-<id>` key gets a stable container name + the branch clone for free. A dedicated primitive (dropping the
  ticket-volume clone, adding env labels) is a clean-up once B2's build-into-image flow exists.
- **Per-env TTL / reaping like previews.** Rejected — an environment is persistent by definition
  (`--restart unless-stopped`); it outlives the orchestrator and is re-asserted on boot.

## Consequences

- Schema grows (`Environment`). Snapshot returns the active project's `environments[]`; the settings page
  gains an Environments card (deploy/teardown per kind).
- The physical `repoStore` per-project clone re-key (deferred from A2) still applies to env deploy for a
  MULTI-repo workspace — an env clones from the workspace-keyed bare mirror, so multi-repo physical isolation
  remains the same known follow-up (single-project deploy works fully). Tracked, not done here.
- B2 builds on this: promote dev→staging→prod (gated), build-into-image, downloadable build export. C1's CI
  gate wires into the prod-promote. Health/readiness (`waitForContainerReady`) is the hook for gated rollout.
