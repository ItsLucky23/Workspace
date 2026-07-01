---
name: shareable-decision-log
title: Ship a committed decision log as the team-shareable decision-memory layer
status: accepted
date: 2026-06-11
deciders: [mathijs]
tags: [ai-tooling, docs, memory, packaging]
supersedes: []
relates: []
---

## Context

LuckyStack's goal is 100%-AI-driven development on every project that installs it. The framework already
ships a strong "read" side (three deterministic committed indexes, per-package docs, branch-logs, slash
commands) and a deterministic "verify" side (`@luckystack/test-runner`). The one structural hole: the
richest accumulated *why* — strict-typing policy, peer-dep-guard, packaging north-star, secret-manager
fail-open, and the rejected alternatives behind each — lived ONLY in a per-developer `~/.claude` memory
palace. That store is local, never committed, invisible to teammates, and lost when a second developer or
a fresh machine joins. A multi-agent design pass (6 independent proposals) had three of six converge
independently on this same gap — the strongest signal in the set.

## Decision

Ship a committed, ADR-style decision log: `docs/decisions/NNNN-slug.md` files (frontmatter + Context /
Decision / Rejected-alternatives / Consequences) and a deterministic `scripts/generateDecisionsIndex.mjs`
emitting `docs/AI_DECISIONS_INDEX.md` (the fourth member of the index family), with
`docs/DECISION_MEMORY_PROTOCOL.md` as the spec. Capture is **automatic AI behavior** (no slash command
the user runs) — mirroring the branch-log protocol: the AI writes a decision when one is made, reads the
index when wondering "why", and offers to backfill from git history when the memory is empty on an
existing project. It rides the existing rung-1 machinery: pure-Node generator, pre-commit regen + git-add,
framework-docs copy-block delivery to consumers. No new package, no peer-deps, no embeddings.

## Rejected alternatives

- **Leave decisions in the per-dev `~/.claude` memory palace** — rejected: not shareable, the entire
  problem. A second teammate inherits nothing.
- **Reuse branch-logs for decisions** — rejected: branch-logs are the per-prompt firehose (what
  happened), not a curated, queryable, supersession-aware record of durable rationale.
- **Jump straight to a RAG/vector store over decisions** — rejected as premature: a committed markdown
  corpus an agent greps + a deterministic index covers the high-value "why" lookups without an embedding
  provider, secret, or non-deterministic index (see 0003).

## Consequences

- A new committed artifact family (`docs/decisions/` + `docs/AI_DECISIONS_INDEX.md`) that every teammate
  and AI session inherits via git. Added to the CLAUDE.md session-start sequence.
- A clear three-way split must be maintained: branch-logs (what happened) vs CLAUDE.md rules (always-on
  imperative) vs decisions (durable why). Documented in the protocol.
- Establishes the pattern the later AI-boost waves (MCP server, native call-graph) build on.
