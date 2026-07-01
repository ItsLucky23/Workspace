---
name: ai-context-layers-before-rag
title: Expand the AI-context system with lessons / examples / coverage gates / eval before any RAG rung
status: accepted
date: 2026-06-29
deciders: [ItsLucky23]
tags: [ai-context, docs, tooling, rag]
supersedes: []
relates: [0001, 0003, 0007]
---

# 0016 — Expand the AI-context system with lessons / examples / coverage gates / eval before any RAG rung

## Context

The AI-context system was already mature (deterministic indexes, a two-layer dependency
graph behind `@luckystack/mcp`, decision memory, the `ai:lint` invariant gate). A docs-system
audit found the remaining high-value gaps were NOT "more structure" but: documentation that
can silently drift to optional, hand-written docs that rot unnoticed, a one-directional
decision memory (ADR→code but not code→ADR), a fixed session-start read list regardless of
task, no curated "right shape" corpus, no shared pitfalls layer, and — critically — no
measurement of whether any of it actually helps the AI. RAG was known-missing but ADR 0003
deliberately keeps it the last rung.

## Decision

Build seven layers on the existing rails (generator → committed artifact → MCP tool →
CLAUDE.md autonomy rule → pre-commit hook → ships under `--ai-docs`), and explicitly NOT
RAG:

- **Doc-coverage gate** (`ai:lint` rule `doc-coverage`) and **doc-staleness** nudge —
  **warn-only / opt-in**, diff-scoped to added files / opt-in `@covers` markers, so an
  existing codebase is never retroactively blocked.
- **Lessons layer** (`docs/lessons/` + `ai:lessons` + `find_lesson`/`get_lesson`) and
  **canonical example corpus** (`docs/examples/` + `ai:examples` + `list_examples`/`get_example`),
  each with the same detect-empty → offer-a-backfill-interview etiquette as the decision memory.
- **Code→ADR reverse link** (`//? @adr NNNN` → `decision_for_file`).
- **Context budget** (`ai:context-budget`) — per-task retrieval profiles.
- **Eval harness** (`eval/`) — the deterministic with/without measurement that is the
  trigger gate ADR 0003 requires before RAG is justified.

All of it mirrors into the scaffold template and ships to consumers under the AI-docs step.

## Rejected alternatives

- **Build RAG / semantic search now.** Rejected: it adds the only real external dependency
  (an embeddings model + secret + per-dev cost) and a non-deterministic index that breaks the
  deterministic-committed-diff property every other artifact has. Most "find where we do X"
  queries are already covered by grep + the symbol graph + `find_route`/`get_capability`.
  Per ADR 0003 it stays the last rung, and the eval harness must first *measure* the structured
  rungs falling short before RAG is warranted.
- **Make the gates blocking by default.** Rejected: it would hard-block existing projects on
  first install. Warn-default + opt-in `block` (via `luckystack.invariants.json`) matches the
  existing `ai:lint` philosophy and keeps the layers safe to adopt incrementally.
- **One mega-doc / mega-generator.** Rejected: each layer is a distinct artifact with its own
  query tool; folding them together would bloat read-whole context and blur the surfaces the
  protocols deliberately keep separate (decisions = why, lessons = what-failed, examples = the-shape).

## Consequences

- Documentation drift becomes a diff-time signal instead of a silent rot; the pitfalls and
  example layers stop the "rediscover the same dead-end" loop and give the AI reviewed shapes
  to copy.
- The template↔root mirror grows; a new `aiScriptParity.test.ts` guards it (parity drift is the
  project's #1 historical defect class — see lesson 0001 and the install-audit history).
- RAG remains deferred, now with an explicit, runnable measurement (`npm run ai:eval`) as its
  precondition rather than a judgement call.
