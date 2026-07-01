---
name: workspaces-guard-false-positives
title: The workspaces no-unnecessary-condition lint errors are CORRECT guards — do not strip them
severity: high
area: src/workspaces
date: 2026-07-01
tags: [lint, typescript, tsconfig, prototype]
---

# 0001 — The workspaces `no-unnecessary-condition` lint errors are CORRECT guards — do not strip them

> A lesson, not a decision: what a future session will be tempted to do, and why it's a bug.

## What happened

After the i18n migration, `npm run lint` on `src/workspaces/**` reports ~15
`@typescript-eslint/no-unnecessary-condition` errors — e.g. `MEMBERS[userId]?.name ?? userId`,
`t.viewers[0] ?? 'mathijs'`, `.filter((m): m is Member => m !== undefined)`. The obvious
"fix" is to delete the `?.` / `?? fallback` / filter because the linter says the condition is
"always truthy / has no overlap". **Doing that introduces real runtime bugs.**

## Root cause

The project's `tsconfig.json` does NOT set `noUncheckedIndexedAccess`. So TypeScript types
`MEMBERS[key]` as `Member` (never `undefined`) and `arr[0]` as `T` (never `undefined`), even
though at runtime an absent record key or an empty array yields `undefined`. The typed-lint rule
therefore believes the guards are redundant — but the guards are exactly what stop a crash when
the key/index is missing. The lint error is a false positive rooted in a project-wide strictness
gap, not dead code.

## How to avoid

- **Never remove these guards to silence the linter.** They are correct defensive code.
- The proper fix is project-wide: enable `compilerOptions.noUncheckedIndexedAccess` in
  `tsconfig.json`. Measured blast radius on 2026-07-01: **56 new `tsc` errors** (42 in
  `src/workspaces`, 14 in framework-overlay code — `Avatar`, `dropdown`, `main.tsx`, settings
  APIs), each a genuine latent undefined-access to fix. That is a deliberate, user-gated
  strictness pass, not a drive-by — hence deferred (recorded here so it isn't lost).
- Until then, treat these specific `no-unnecessary-condition` errors as known-correct and leave
  them. Same for `@typescript-eslint/no-empty-function` on the not-yet-wired Fase-1 stub handlers
  (Board menu items, Terminals actions, the `WorkspacesShell` notification/FAB `noop`) — they
  resolve when their feature is wired in Fase 1, not by faking a body.
