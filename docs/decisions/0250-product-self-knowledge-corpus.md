---
title: Q1 — product self-knowledge corpus (generator)
status: accepted
date: 2026-07-08
tags: [ai, rag, self-knowledge, capabilities, ai-libraries-accounts]
---

## Context

The in-app Workspace-AI grounds only on the workspace snapshot + the user's linked code (RAG). It has ZERO
knowledge of what the PRODUCT itself can do, so it cannot answer "can we edit videos?" ("yes — via the media
module, first generate/upload a video then use the timeline editor"). The rich self-knowledge (161 ADRs + the
capability inventory) exists as committed docs but is only reachable by the dev-time `@luckystack/mcp` server,
never at runtime. Q1 compiles that knowledge into a retrievable corpus.

> **ADR numbering:** this program (`AI_LIBRARIES_ACCOUNTS_PROGRAM.md`) runs on the `feat/ai-libraries-accounts`
> branch in parallel with the ADOPTION run, which consumes 0162+. To avoid merge-time number collisions, this
> program's ADRs start at **0250**.

## Decision

- **A hand-curated capability Q&A** (`docs/product-knowledge/capabilities.md`) is the primary source: plain-
  language "can I do X? → yes, via module Y, steps ..." blocks, one `### Q:` per capability. This is what makes
  the AI genuinely helpful ("how do I ...") rather than just factual.
- **A deterministic generator** (`scripts/generateProductKnowledge.mjs`, `npm run ai:product-knowledge`,
  wired into the pre-commit hook) compiles the Q&A + every ADR (title + Context/Decision summary) into two
  artifacts: `docs/AI_PRODUCT_KNOWLEDGE.md` (human digest) + `docs/AI_PRODUCT_KNOWLEDGE.json` (`{hash,
  chunks:[{id,kind,title,text}]}` — the embedding input). Pure-Node, no timestamps → byte-identical no-op runs.
- **A content `hash`** on the shard lets the runtime boot-ensure (Q2) re-embed only when the corpus changed.

## Rejected alternatives

- **Embed the whole ADR files verbatim.** Too noisy for retrieval; the Context+Decision summary per ADR is the
  signal. The hand Q&A carries the "how", which no ADR states in user terms.
- **Query the `@luckystack/mcp` capability tools at runtime.** That server is a dev-time stdio tool over
  committed markdown with no app dependency; wiring it into a runtime chat request is heavier + fragile. A
  compiled corpus embedded via the existing RAG is simpler and offline-safe.
- **Bake the corpus into the system prompt as static text.** 177 chunks blow the prompt budget; retrieval
  surfaces only the relevant few per question. (A tiny always-on capability index in the prompt is a Q3
  addition on top, not a replacement.)

## Consequences

- The product's self-knowledge is now a compiled, hashed corpus (177 chunks: 17 capabilities + 160 ADRs),
  regenerated on every commit. Q2 embeds it behind the existing `retrieve()` API (global, sentinel workspace);
  Q3 wires it into `workspaceChat` + `workspaceAiPrefix`. Verified deterministic + shape-tested (9/9). The
  capability Q&A is the file to keep current as features land.
