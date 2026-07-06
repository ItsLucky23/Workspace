---
id: 0087
title: Content insights dashboard + style library + brand editor
status: accepted
date: 2026-07-06
tags: [content, insights, analytics, brand, ui, depth-program]
supersedes: []
depends_on: [0072, 0084, 0071]
---

# U4 — surface analytics + styles + a per-channel brand editor

## Context

The content-analytics fold (F5.1) + the style library + per-channel brand were computed/stored but never
surfaced. U4 exposes them and lets a creator tune the brand.

## Decision

- **Snapshot extension:** `ContentSnapshot` gains `analytics` (from `computeContentAnalytics` over the
  workspace's pieces + media spend + publish jobs), `styles` (StylePreset — this workspace's + the global
  defaults), and `channels` (id/name/platform/brandVoice). Built in `workspaceSnapshot.ts`.
- **`content-edit-brand` control-op** — updates a `Channel.brandVoice` + re-indexes the snippet into
  brand-RAG (`indexChannelBrand`, F5.1) so every generation for the channel can ground on it. RBAC:
  `workspaceSettings`; dispatched via the `contentSettings` route (B-23); ctx method `editChannelBrand`.
- **`content/insights/page.tsx`** — an analytics dashboard (pieces/done/published/spend stat cards +
  pieces-by-stage bars + cost-by-feature), the style library (built-in vs custom), and a per-channel
  brand-voice editor. Reachable via an Insights button on the content board. i18n ×4; theme tokens only.

## Rejected alternatives

- **A separate analytics service call.** Rejected — `computeContentAnalytics` is a pure fold; computing it
  in the snapshot keeps one realtime read-path (no extra round-trip).

## Consequences

- `ContentSnapshot` + snapshot builder + `content-edit-brand` (union/rbac/conductor) + the sync-route
  whitelist + ctx method + the insights page + ~20 i18n keys. `tests/integration/contentInsights.test.mts`
  (10/10) proves the analytics/channels folds + the brand op (channel update + brand-RAG index +
  snapshot reflection). `contentSnapshot` 7/7 + `snapshot` 21/21 + rbac unaffected. **Fase U complete.**
