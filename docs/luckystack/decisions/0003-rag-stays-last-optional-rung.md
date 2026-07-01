---
name: rag-stays-last-optional-rung
title: RAG stays the last, optional rung — no @luckystack/rag for the v0.2.x era
status: accepted
date: 2026-06-11
deciders: [mathijs]
tags: [ai-tooling, rag, packaging, roadmap]
supersedes: []
relates: [0001, 0002]
---

## Context

`docs/AI_BOOST_OVERVIEW.md` (line ~125) states RAG is "project-specific, not framework-provided" and to
"reach for it last". The AI-boost design pass confirmed RAG is the only candidate capability that
genuinely requires an external dependency — an embeddings model (Voyage AI, or a heavy local model),
since Claude has no embeddings endpoint — plus a secret and a non-deterministic, only-"functionally"-
shareable index. The user wants the full long-route build with minimal third-party tooling, and asked
specifically whether to flip the RAG stance.

## Decision

Hold the documented stance for the v0.2.x era: do NOT ship `@luckystack/rag` yet. Build the native,
deterministic, zero-extra-dependency capabilities first (decision log, runbooks, invariant linter, the
MCP server, the native call-graph). Revisit RAG only AFTER those ship and grep-over-committed-decisions +
the call-graph are measured genuinely insufficient for natural-language recall. If/when RAG is built, it
is an opt-in `@luckystack/rag` package fronted by the shared MCP server, with embeddings provider (local
vs Voyage) and a manifest-not-vectors commit strategy decided at that point — and that flip gets its own
superseding ADR.

## Rejected alternatives

- **Flip the stance now and build `@luckystack/rag`** — rejected: it adds the only true third-party
  dependency in the whole plan (against the user's minimal-third-party constraint), a secret, per-dev
  cost or a hundreds-of-MB local model, and a non-deterministic index — for value that the committed
  decision log (0001) + native call-graph (0002) largely already deliver via structured retrieval.
- **Declare RAG permanently out of scope** — rejected: too absolute. Natural-language recall over a large
  corpus is a real capability the structured rungs structurally cannot provide; keep the door open behind
  a measured trigger.

## Consequences

- The AI-boost roadmap is: native/minimal-dep capabilities first; RAG is a gated Wave 4, not part of the
  v0.2.0 push.
- `AI_BOOST_OVERVIEW.md`'s RAG-as-last-rung line stays correct and is explicitly reaffirmed (not flipped),
  unlike the graphify stance in 0002.
- A future decision to build `@luckystack/rag` must supersede this ADR with the provider + index-sharing
  choices made explicit.
