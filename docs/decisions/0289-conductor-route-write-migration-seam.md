---
id: 0289
title: Conductor route-write migration seam
status: accepted
date: 2026-07-21
tags: [conductor, single-writer, tenancy, migration]
summary: Legacy API writers enter the tenant-scoped Conductor lease through an explicit transitional callback seam while slow provider/build work stays outside the lease.
---

## Context

Several authenticated `_api` routes predated the control-API split and still mutated Prisma or repository files directly. Moving account, PAT, Studio, AI-chat and file writes into new public control verbs would expand the frozen structured surface and expose route-internal operations to the Assistant. Holding the workspace lease around Studio generation, documentation generation or Docker image builds would block unrelated writes for seconds or minutes.

## Decision

Legacy route-internal writes use `enqueueWorkspaceRouteWrite` or `enqueueGlobalRouteWrite`. Workspace writes execute under the cross-instance workspace lease, writer context and `runInTenant`; global account writes execute on the global writer chain. Slow AI/provider/image-build work runs before the lease, followed by a short completion write through the seam. Worktree writes re-check the stage edit lock inside that lease.

This is explicitly a migration seam, not the target for new domain operations. It appends an audit signal, but arbitrary callbacks are not reconstructable after a process crash. New durable domain work continues to use typed `ControlOp`/`InternalOp`; remaining callback users must migrate to typed replayable jobs before the seam can claim crash durability.

## Rejected alternatives

- **Add public control verbs for every route helper:** violates the frozen structured surface and makes account/internal mechanics Assistant-proposable.
- **Keep direct Prisma/filesystem writers:** violates single-writer ordering and tenant-context enforcement.
- **Hold the writer lease around provider/build work:** creates workspace-wide head-of-line blocking and increases lease-loss risk.
- **Describe callback signals as durable execution:** rejected because their closures cannot be reconstructed after restart.

## Consequences

- Route writes are serialized and tenant-scoped immediately.
- Slow Studio/docs/image work only uses short begin/completion leases.
- The seam's signals are audit evidence, not crash-replay jobs.
- Runtime launches/import completion and every remaining seam callback still need typed durable job migration.
