---
name: symbol-graph-in-script-not-devkit
title: Implement the symbol-level call graph in scripts/generateGraph.mjs (typescript package), not in @luckystack/devkit
status: accepted
date: 2026-06-11
deciders: [mathijs]
tags: [ai-tooling, graph, devkit, packaging]
supersedes: []
relates: [0002, 0004]
---

## Context

ADR 0002 chose a TS-native call-graph "inside `@luckystack/devkit`, on its existing `getServerProgram()` +
`TypeChecker`". ADR 0004 sequenced it as Phase 2 after the file-level graph. When building Phase 2, the
file-level graph already lived in `scripts/generateGraph.mjs` with all the wiring around it: the `ai:graph`
npm script, the pre-commit regen + git-add, the byte-for-byte `template/` mirror, and the
`docs/ai-graph.json` output contract the MCP server reads. Putting the symbol pass in devkit instead would
mean a new devkit bin, a tsup entry, and splitting graph production across two places (a `.mjs` for
import-level + a devkit bin for symbol-level) feeding one artifact — more moving parts for no user-visible
gain. `typescript` is already a devDependency in every consumer (the template ships it), so a `.mjs` can
`import ts from 'typescript'` and build a `ts.Program` from `tsconfig.server.json` directly.

## Decision

Implement the symbol-level call graph in `scripts/generateGraph.mjs` using the `typescript` package
directly (build a `ts.Program` from `tsconfig.server.json`, walk `CallExpression`/`NewExpression`, resolve
callees via the `TypeChecker`), emitting `symbols` / `callEdges` / `symbolBlastRadius` alongside the
existing file-level fields in the same `docs/ai-graph.json`. This refines ADR 0002's "inside devkit"
placement: the *capability* (TS-compiler symbol resolution) is delivered as 0002 intended; only the *home*
is the existing generator script, to preserve the single `ai:graph` entry + pre-commit + template-mirror
wiring. The MCP server gains a `who_calls(symbol)` tool over `symbolBlastRadius`.

## Rejected alternatives

- **Put it in `@luckystack/devkit` (ADR 0002's literal placement)** — rejected for now: needs a new bin +
  tsup entry and splits graph production across a `.mjs` and a devkit bin into one artifact. More surface,
  no user-visible benefit; devkit's `getServerProgram` is internal and re-deriving the program in the
  `.mjs` is ~10 lines.
- **Skip symbol-level, keep file-level only** — rejected: the user explicitly asked for the TS-compiler
  pass so the graph is "complete"; file-level over-approximates change-impact.

## Consequences

- One generator owns the whole graph; wiring is unchanged. `typescript` is a hard input to `ai:graph` now
  (already a consumer devDependency, so fine).
- The symbol pass builds a full `ts.Program` (~4–5s on this repo) — the heaviest pre-commit step. Guarded
  by `SYMBOL_FILE_CAP` (skip + warn above it), and it degrades to import-level on any compiler error. If
  commit latency becomes a problem on a big repo, move `ai:graph` out of the pre-commit hook to CI /
  on-demand (the AI still refreshes it in-session per CLAUDE.md Rule 12).
- Coverage is documented in `ai-graph.json`'s `note` (functions.* proxy / dynamic import / interface-typed
  calls not resolved; `<module>` = file top-level scope). Cross-file edges appear only where project code
  actually calls project code (this sample app routes through framework packages, so it shows few).
- ADR 0002 / 0004 remain valid as the "TS-native call-graph" intent; this records where it lives.
