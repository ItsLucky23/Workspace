---
id: 0050
title: Content-platform data model — projectType lane + 9 content models (F0.1)
status: accepted
date: 2026-07-06
tags: [content, schema, data-model, projectType, expansion-f01]
supersedes: []
depends_on: [0049, 0035]
---

# Content-platform data model (F0.1)

## Context

First item of `CONTENT_PLATFORM_PROGRAM.md` (ADR 0049) — schema-first. The content lane needs its data model published before any engine/client work.

## Decision

1. **A `projectType` on Project** (`'dev'` | `'content'`, default `'dev'`) selects the workflow lane. Zero migration for existing projects (default).
2. **Nine content models**, all tenant-scoped by **explicit `workspaceId` filtering** (NOT the `tenantDb` `$extends` auto-scoping): `Channel` (distribution target + house style), `ContentProject` (a content piece flowing the pipeline — `stageId`/`status` mirror Ticket so the generic stage-runner drives it), `ContentAsset` (a produced media asset), `Script` + `Beat` (narration + storyboard), `MediaJob` (async generation to a provider, `costCents` metered), `RenderJob` (Remotion assembly), `StylePreset` (a named style, `workspaceId` null = global default / set = per-workspace), `MediaSpend` (the €-cost ledger, cents).
3. **Media cost in CENTS** on `MediaJob`/`RenderJob`/`MediaSpend` — metered real-money €, distinct from the coding-agent token accounting (invariant #9).

## Rejected alternatives

- **Content pieces reuse `Ticket`.** Rejected — a distinct `ContentProject` keeps content fields off the (GitLab-shaped) Ticket while still mirroring `stageId`/`status` so the stage-runner stays generic (wired in F1.1).
- **Add the content models to `TENANT_MODELS` (`tenantDb` auto-scoping).** Rejected — the other feature models (Service/ForgeConnection/Studio*/Environment) are NOT in that set; they scope by explicit `workspaceId` filtering via the Conductor's raw prisma. Content follows that established precedent (consistency; the Conductor is the writer).
- **Auto-seed a content project in `createBlankWorkspace`.** Rejected for now — adding a 2nd project to every workspace would break the ~30 tests that assume one project (snapshot/project-count). Content projects are created on demand (a control-op, F1.1); the F0.1 test creates them explicitly. (Flagged as an OPEN VRAAG in the branch-log — revisit if a default content project is wanted.)

## Consequences

- New `projectType` field + 9 models in `prisma/schema.prisma`; pushed (`prisma:db:push`) + client regenerated. Added to `tests/_helpers.mts` `cleanupWorkspace` (children before parents).
- `tests/integration/contentModel.test.mts` (18 assertions) verifies the round-trip + row-isolation between two workspaces + cents cost.
- Downstream items (F0.2 budget guard, F0.3 providers, F0.4 styles, F1.x pipeline) build on these models.
