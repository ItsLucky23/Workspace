---
id: 0068
title: Main-navbar grouping (F4.1)
status: accepted
date: 2026-07-06
tags: [frontend, navbar, ux, expansion-f41]
supersedes: []
depends_on: [0049]
---

# Main-navbar grouping (F4.1)

## Context

The main nav rail is a flat list of 11 items — the user asked to declutter it with better GROUPING + a contextual secondary navbar, plus lazy-loading for bundle size. F4.1 delivers the grouping (the highest-value, lowest-risk part) now; the richer per-area secondary navbar + lazy-loading are scoped follow-ups (they need browser verification, which is deferred with no keys/running server).

## Decision

Each `NavDef` gets a `group` (`work` | `build` | `studio` | `insights`); the rail renders items grouped under section headers (expanded) or thin dividers (collapsed), in `GROUP_ORDER`. Group labels render via a variable (`GROUP_LABELS[g]`), matching the existing nav's variable-rendered `it.label` (no new i18n debt; consistent with the current pattern). Theme tokens only (`text-disabled`, `bg-divider`).

## Rejected alternatives

- **A full contextual second navbar per area now** (like tickets under pipeline). Deferred — a larger shell rewrite with animation/state implications that needs a browser pass to verify (deferred: no keys / server). The grouping headers deliver the "less cluttered, sectioned" intent safely; the second navbar is a follow-up.
- **Convert views to `React.lazy` now.** Deferred — the view→component router isn't a simple switch in `Shell.tsx`; converting it blind (no browser verification) is risky. Vite already dynamic-import code-splits; a targeted `React.lazy` pass is a follow-up.
- **i18n the group labels while items stay hardcoded.** Rejected — inconsistent; the whole nav renders labels via variables, so group labels follow suit (a nav-wide i18n pass is a separate cleanup).

## Consequences

- `NAV_ITEMS` grouped + the rail renders section headers/dividers (`src/workspaces/_shell/Shell.tsx`). Build + lint + ai:lint green. Verified by build; the visual is confirmed in the deferred browser pass.
- Follow-ups (documented): the contextual second navbar per area, `React.lazy` view-splitting, a nav-wide i18n pass.
