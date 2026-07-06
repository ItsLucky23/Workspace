---
id: 0069
title: Content lane in the snapshot (F4.2)
status: accepted
date: 2026-07-06
tags: [content, snapshot, ui, expansion-f42]
supersedes: []
depends_on: [0049, 0050, 0051]
---

# Content lane in the snapshot (F4.2)

## Context

The content UI + settings need the content state on the client. F4.2 wires the content lane into the workspace snapshot (the testable, enabling core); the rich page components + the settings FORM are the browser-deferred layer (no keys / running server for a visual pass).

## Decision

The snapshot gains `content: ContentSnapshot` — `pieces` (the non-archived `ContentProject`s: id/title/format/stageId/status/channelId) + `mediaBudget` (the `getMediaBudgetStatus` fold: enabled/cap/spent/alert/overAlert). Content models scope by explicit `workspaceId` (via `currentWorkspaceId()` inside `runInTenant`), matching the feature-model pattern (ADR 0050) — NOT `tenantDb` (content isn't in `TENANT_MODELS`). Threaded through `WorkspacesProvider` + `WorkspacesContext` so any content surface reads `content` from context.

## Rejected alternatives

- **Build the full content board/asset pages + the provider-key settings form now.** Deferred — those are visual and need the deferred browser pass; the snapshot wiring is the testable, enabling deliverable. The pages read `content` from context when built.
- **Scope content in the snapshot via `tenantDb`.** Rejected — content models aren't in `TENANT_MODELS`; explicit `workspaceId` filtering (the F0.1/0050 decision) is used, so an unscoped `tenantDb` read would leak across workspaces. `currentWorkspaceId()` gives the id inside the tenant closure.

## Consequences

- `ContentSnapshot` type + snapshot `content` (server) + provider/context wiring (client). Build + lint + ai:lint green. The content UI + settings form render from `content` (browser-deferred).
- `tests/integration/contentSnapshot.test.mts` (7): a content piece + budget status appear in `snapshot.content`; an archived piece drops out. Existing `snapshot.test` 21/21 (additive field, no break).
