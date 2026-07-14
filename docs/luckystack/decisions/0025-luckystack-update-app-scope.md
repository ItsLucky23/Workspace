---
status: accepted
date: 2026-07-13
tags: [cli, update, scaffold, dx]
amends: [0021]
---

# `luckystack update --app` refreshes framework-authored src/ files (the upgrade gap)

## Context

ADR 0021 built `luckystack update` to refresh framework-OWNED copied files
(docs/luckystack, CLAUDE.md, skills, scripts, templates) from a fresh scaffold
render, and deliberately scoped it to NEVER touch `src/`, `functions/`,
`config`, `prisma` — "that's user code". That left a real gap: when a framework
RELEASE ships new or changed files that must live under `src/` (a feature's UI
+ routes — e.g. the 2FA `LoginForm` phase machine + `TwoFactorSection` in
0.6.0), a consumer who UPGRADES via `npm install` (not a re-scaffold) has no
way to receive them. `npm install` can't (src/ is the consumer's tree),
`luckystack update` (framework scope) won't (src/ is out of scope), and
`luckystack add <feature>` is copy-if-absent so it can't refresh a file the
consumer already has. The 0.6.0 upgrade runbook had to say "hand-port the UI",
which is exactly the friction this ADR removes.

New config VALUES are a non-problem (they deep-merge from
`DEFAULT_PROJECT_CONFIG` in core, delivered by `npm install`); this is only
about FILES.

## Decision

Add an opt-in `--app` scope to `luckystack update`. It reuses the exact
mechanism ADR 0021 built (fresh scaffold render with the recorded manifest
choices = single source of truth; per-file add / overwrite-if-pristine /
sidecar-if-modified / unchanged), and only broadens which files are in scope.

Safety comes from two INVARIANTS, not a narrow allow-list:

1. **Only files present in the FRESH RENDER are ever considered.** A consumer's
   own app code is never in the render, so it is never touched (no overwrite,
   no sidecar).
2. **A user-modified file is NEVER overwritten** — it gets a `<file>.new`
   sidecar plus an AI-merge instruction in `dump/UPDATE_<hash>.log`. Only a
   file whose current hash matches the scaffold-manifest baseline (provably
   unedited) is refreshed in place. New framework files are copied in.

A short DENY-LIST still guards files too critical or too personal to touch even
as a sidecar: `prisma/` (DB schema), `.env` / `.env.local` (real secrets),
`package.json` / `package-lock.json` (deps — npm's job), the scaffold manifest,
`node_modules/`, `.git/`. Everything else framework-authored (src/ UI + routes,
functions/, server/, luckystack/, config.ts, tsconfig) is in scope under
`--app`.

Default stays `framework` scope (ADR 0021 behavior) — `--app` is explicit.

## Rejected alternatives

- **Make it the default `update` behavior** — a silent contract change on a
  published command; opt-in is safer and discoverable via a hint the
  framework-scope run prints when it has nothing to do.
- **A separate `luckystack upgrade` command** — needless surface; `update` +
  `--app` is one concept (refresh copied files) with a scope knob.
- **Overwrite ALL framework src/ files (like `add`'s copy, but forced)** —
  would clobber the developer's edits; the sidecar-for-modified rule is the
  whole point.
- **Include `prisma/` / config secrets** — a `schema.prisma.new` with only the
  framework's User model is a footgun (a careless merge nukes the consumer's
  models); schema/secret changes stay documented via CHANGELOG + runbook.

## Consequences

- An upgrade flow becomes: bump `@luckystack/*` → `npm install` → `npx
  luckystack update --app` → review/merge the `.new` sidecars (an AI agent can
  apply the report) → done. The 2FA-style "hand-port the UI" step is gone.
- `update` (framework scope) is unchanged for existing users; it now prints a
  hint pointing at `--app` when it has nothing to refresh.
- The report gains "new framework files delivered" + (app scope) "refreshed"
  sections for reviewability.
