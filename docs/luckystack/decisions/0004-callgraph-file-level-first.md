---
name: callgraph-file-level-first
title: Ship the call-graph file/import-level first (pure-Node), symbol-level (TS compiler) as a later increment
status: accepted
date: 2026-06-11
deciders: [mathijs]
tags: [ai-tooling, graph, devkit, scope]
supersedes: []
relates: [0002]
---

## Context

ADR 0002 committed to a TS-native call-graph on `@luckystack/devkit`'s `ts.Program` + `TypeChecker`.
While building Wave 3 it became clear that symbol-level call resolution (function→function, resolving
each callee through the `functions.*` injection proxy, interface methods, dynamic imports) is a large,
genuinely fuzzy build that needs devkit build changes (new bin, tsup entry) and careful determinism work.
Meanwhile the user's primary ask — "what breaks if I change this?" (blast-radius) and "which files are
god-nodes?" — is answered at **file/import granularity** by reusing the exact regex import-extraction +
resolution already proven in `generateProjectIndex.mjs`, with zero new dependencies and the same
deterministic-committed-artifact shape as the other indexes.

## Decision

Ship the call-graph in two phases. **Phase 1 (now):** `scripts/generateGraph.mjs` — a pure-Node,
file/import-level dependency graph emitting deterministic `docs/ai-graph.json` (nodes classified
api/sync/page/helper/component/other, resolved import edges, transitive reverse-reachability =
blast-radius, god-nodes by transitive-dependent count). It ships exactly like the other generators
(npm script + pre-commit + template mirror) and is queried by the `@luckystack/mcp` server. **Phase 2
(later):** the symbol-level TS-compiler call-graph from ADR 0002, layered on top — same `ai-graph.json`
contract, adding function-to-function edges.

## Rejected alternatives

- **Build symbol-level (ADR 0002) first, before any graph ships** — rejected: much larger + fuzzier, would
  delay the blast-radius/god-node value that the file-level graph delivers immediately at a fraction of
  the cost and zero new deps.
- **Only ever do file-level, drop symbol-level** — rejected: function-to-function edges add real precision
  (a file-level edge over-approximates impact). Keep 0002 alive as the Phase-2 increment, not cancelled.

## Consequences

- `docs/ai-graph.json` exists now with blast-radius + god-nodes at file granularity; the MCP server's graph
  tools read it. `ai-graph.json` carries a `note` field stating the granularity (honest "no silent cap").
- ADR 0002 stays `accepted` as the Phase-2 target; this ADR refines its sequencing, it does not supersede
  it. When Phase 2 lands it enriches the same artifact rather than replacing it.
- File-level edges over-approximate change-impact (a whole-file edge even when only one unused export
  changed). Acceptable for a "what could be affected" signal; Phase 2 tightens it.
