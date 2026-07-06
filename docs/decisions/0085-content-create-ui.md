---
id: 0085
title: Content piece detail + generation controls firing control-ops
status: accepted
date: 2026-07-06
tags: [content, ui, control-op, depth-program]
supersedes: []
depends_on: [0072, 0084, 0069]
---

# U2 — turn a piece into media from the UI (behind the B-23 gate)

## Context

U1 made the content lane reachable (board). U2 gives a piece a detail view with the generation
controls a non-technical user needs — and wires the FIRST content control-op that fires from the UI.

## Decision

- **One generic sync route** `contentControl_server_v1.ts` dispatches the content-op family
  (whitelisted: create/advance/archive + every gen op + assemble + request-publish) through the shared
  `dispatchControlSync` (RBAC + single-writer Conductor, B-23). A type-guard narrows the op to `ControlOp`
  — no cast. (Content ops previously had backend cases + tests but no client route.)
- **Client method** `runContentOp(op, contentProjectId, payload)` on the workspaces ctx fires
  `workspaces/contentControl` and refetches; typed on `WorkspacesCtx`.
- **`content/[pieceId]/page.tsx`** — a piece detail: header (format/stage/status), a "creative direction"
  panel (style + free-form instructions + reference URL), and a grid of generation actions (script ·
  voice · images · reference-image · short-form · music · sfx · 3D · assemble). Each action fires its
  control-op **behind a `menuHandler.confirm`** with a cost warning (budget-aware). All text i18n ×4
  (`workspaces.content.*`, 41 keys); theme tokens only.

## Rejected alternatives

- **A `_sync` route per content op (~16 routes).** Rejected — one whitelisted generic route is far less
  boilerplate and still fully RBAC/Conductor-gated; the whitelist keeps the client from driving arbitrary ops.
- **Fire without a confirm.** Rejected — media generation costs real money; a confirm per generation is
  the budget-aware, non-technical-safe default.

## Consequences

- New sync route + ctx method + detail page + 25 more content i18n keys. `generateArtifacts` refreshed the
  type maps. The asset viewer is a placeholder (the per-piece asset list is a snapshot extension —
  browser-deferred); U4 surfaces the analytics/brand/style folds. Verify: build + i18n×4 + a control-op
  fires from the UI (behind confirm). Live generation is the post-keys e2e.
