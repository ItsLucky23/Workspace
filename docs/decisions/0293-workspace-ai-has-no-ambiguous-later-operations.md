---
id: 0293
title: Workspace-AI has no ambiguous later operations
status: accepted
date: 2026-07-21
tags: [ai, tools, reliability, security]
summary: Every frozen control operation is either enabled with a valid effect path or explicitly excluded; the former seven-operation later bucket is removed.
---

## Context

The exhaustive Workspace-AI catalog still classified seven operations as `later`. That state did not tell users or maintainers whether an operation lacked wiring, duplicated another verb, needed unavailable context or was intentionally outside the workspace assistant boundary. Leaving entries ambiguous also allowed future work to mistake catalog presence for an executable effect.

## Decision

The catalog has only `enabled` and `excluded` outcomes.

`db-migrate-apply` is enabled because an existing pending migration can be validated from tenant-scoped context, dispatched through the existing project-admin sync route and protected by destructive confirmation plus the route's own approval/environment gates.

The other six operations are excluded:

- `gitlab-verify` duplicates the real credential-free resync/connectivity path and its legacy handler is a no-op.
- `raise-cap` aliases canonical `edit-budget`.
- `content-create` duplicates the richer brief-based content creation path.
- `content-reorder-beats` and `content-save-scenes` require a complete destructive timeline graph that is intentionally owned by the visual editor.
- `copy-workspace-assets` crosses workspace boundaries and remains an explicit UI flow where both memberships can be shown and confirmed.

## Rejected alternatives

- **Keep `later`:** preserves ambiguity and gives no enforceable product contract.
- **Enable every catalog verb for nominal parity:** creates duplicate, context-incomplete or cross-tenant tools and risks success-without-effect.
- **Delete verbs from the frozen control union:** breaks compatibility and is unnecessary; exclusion is an explicit classification.
- **Let the model infer migration IDs:** permits dangling or cross-project references; only IDs loaded from pending tenant-scoped migrations validate.

## Consequences

- The catalog remains exhaustive but has no unowned future-state bucket.
- Chat can apply only a real pending migration and always requires explicit destructive confirmation.
- Duplicate and cross-workspace capabilities do not consume the per-turn tool budget.
- A future reclassification from excluded to enabled requires context validation, dispatcher wiring and effect-matrix coverage.
