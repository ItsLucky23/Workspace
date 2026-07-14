---
name: scaffold-manifest-and-luckystack-update
title: Scaffold writes a manifest (.luckystack/scaffold.json); updates to copied files go through an explicit `luckystack update` that never overwrites user-modified files (AI-assisted merge via change-notes)
status: accepted
date: 2026-07-08
deciders: [ItsLucky23]
tags: [scaffold, cli, updates, dx]
supersedes: []
relates: [0014, 0020]
---

## Context

Framework updates only flow through npm package bumps. Everything the scaffold copies **into** a consumer's codebase (docs/luckystack snapshot, CLAUDE.md, skills, .claude/commands, generator scripts, starter src/, functions/, config, prisma schema) has no update path at all: no version stamp, no file manifest, no hashes, no scaffold-time git baseline. Copied files are `{{VAR}}`-rendered from the template, so a consumer file can never be diffed against the raw template without re-rendering with the original choices. `luckystack add` is strictly skip-if-exists. The planned ROADMAP `sync-docs` item covers docs only and was never built. ADR 0014 chose "infer, don't store" for CLI project state, which deliberately leaves migration-bearing axes (dbProvider — and now orm, [0020]) non-reconfigurable.

## Decision

1. **Scaffold manifest**: `create-luckystack-app` writes `.luckystack/scaffold.json` at scaffold time = `{ version, choices, templateVars, files: [{ path, sha256 }] }` (hashes computed after `{{VAR}}` render). Recording choices/vars is non-negotiable — it is what makes any later re-render/diff valid, and it is the persisted state that unblocks ORM/dbProvider reconfigure in the manage CLI.
2. **Explicit `luckystack update` command** (never implicit on `npm update`): per file, hash-compare against the manifest. Pristine → safely overwritten with the new version's render. **User-modified → never overwritten**; the command emits a change-note (diff between the previous and new framework version of that file) that the project's AI merges into the user's modified copy; `.new` sidecars as the non-AI fallback. `CLAUDE.md` merges by section: the framework part is replaceable, the "User Project Rules" section below the fixed divider is user-owned.
3. **First scope**: the framework-owned, rarely-edited bucket (docs/luckystack/**, CLAUDE.md, skills/**, .claude/commands/**, generator scripts, eslint.luckystack/official configs, _dot_luckystack templates). Template source = run the scaffolder into a temp dir with the recorded choices and diff/copy from there (one source of truth). This subsumes the ROADMAP sync-docs item.

## Rejected alternatives

- **Blind overwrite of copied files on package update** — rejected: destroys user edits; the user explicitly vetoed this.
- **Status quo (manual copying per the current docs guidance)** — rejected: doesn't scale past docs, and even the docs half (sync-docs) never got built.
- **Full three-way merge engine as the first deliverable** — rejected for now: heavy to build; deferred until the manifest has been shipping in the wild.
- **Per-version codemod stream as the first deliverable** — rejected for now: per-release authoring cost; deferred — `transitions.ts` is the natural engine for it later, for the user-owned files the update command refuses to touch.

## Consequences

- The manifest stamp should ship as soon as possible — every stamped project widens the future update surface.
- Stamp-less legacy projects: never blind-overwrite; sidecar-only mode.
- Git presence is not guaranteed (scaffold doesn't `git init`): detect a repo and fall back to sidecars when absent.
- Partially refines ADR 0014: inference remains the model for feature axes; persisted scaffold state is added for migration-bearing axes and as the update baseline. 0014 stays accepted for its scope.
- Follow-up phases: three-way merge and version-keyed codemods (via `transitions.ts`) for user-owned files.
