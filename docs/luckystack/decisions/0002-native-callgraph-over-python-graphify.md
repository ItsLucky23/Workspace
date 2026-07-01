---
name: native-callgraph-over-python-graphify
title: Build the call-graph natively in TypeScript instead of the external Python graphify tool
status: accepted
date: 2026-06-11
deciders: [mathijs]
tags: [ai-tooling, devkit, graph, packaging]
supersedes: []
relates: [0001, 0003]
---

## Context

`docs/AI_BOOST_OVERVIEW.md` documents a 3-rung "scaling AI context" ladder (indexes → graphify → RAG),
and `docs/GRAPHIFY_INTEGRATION.md` positions graphify — a Python CLI — as an external, opt-in tool
"not part of LuckyStack". Only rung 1 ships today. The flat indexes answer single-hop "what imports X"
but not "what transitively calls X / what's the blast radius of changing Y / which are the god-nodes".
The user's constraint for the AI-boost work is **minimal third-party tooling**. Asking a JS/TS team to
install Python + commit a non-deterministic blob is exactly the friction the framework's AI-tooling
identity (small, deterministic, committed, zero extra runtime) exists to avoid. Meanwhile `@luckystack/
devkit` already runs a cached `ts.Program` with a live `TypeChecker`, and `importDependencyGraph.ts`
already does reverse-BFS over module edges.

## Decision

When the call-graph capability is built (AI-boost Wave 3), reimplement it TS-native inside
`@luckystack/devkit` on the existing `ts.Program` + `TypeChecker`, emitting a deterministic committed
`docs/ai-graph.json` + graph tools on the shared MCP server. Do NOT adopt the external Python graphify as
the framework's graph layer. This deliberately deviates from `GRAPHIFY_INTEGRATION.md`'s "external,
opt-in, not part of LuckyStack" framing (CLAUDE.md Rule 3b) — that doc + the AI_BOOST_OVERVIEW rung-2 text
must be rewritten in lockstep when Wave 3 lands.

## Rejected alternatives

- **Adopt external Python graphify as-is (the documented stance)** — rejected: violates the
  minimal-third-party constraint (Python runtime), ships a 1-10 MB non-deterministic blob, needs
  post-checkout hooks. High friction for the capability gained.
- **Fork/wrap graphify as a @luckystack package** — rejected: still drags the Python dependency and the
  non-deterministic output along.
- **Do nothing; the flat indexes are enough** — rejected: they genuinely cannot answer transitive /
  blast-radius / centrality questions, which bite on bigger projects.

## Consequences

- Wave 3 carries real cost: symbol-level call resolution on the TypeChecker is materially harder than the
  import-edges already in `AI_PROJECT_INDEX` (interface methods, the `functions.*` injection proxy,
  dynamic import are fuzzy) and determinism is load-bearing. Ship with an explicit edge-coverage
  statement, the way the Zod emitter documents its `z.any()` fallbacks.
- `GRAPHIFY_INTEGRATION.md` + `AI_BOOST_OVERVIEW.md` rung-2 become stale-pending until Wave 3; flagged
  here so the rewrite is a conscious follow-up, not a silent contradiction.
- The graph hangs off the shared MCP server (Wave 2), not a standalone surface.
