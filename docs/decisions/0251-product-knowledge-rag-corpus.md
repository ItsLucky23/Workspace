---
title: Q2 — product-knowledge RAG corpus (global, behind the existing retrieve)
status: accepted
date: 2026-07-08
tags: [ai, rag, self-knowledge, retrieval, ai-libraries-accounts]
---

## Context

Q1 compiled the product's self-knowledge into `docs/AI_PRODUCT_KNOWLEDGE.json` (capability Q&A + ADR
summaries). Q2 makes it retrievable at chat-time so the Workspace-AI can answer capability questions. The RAG
store (`RagEntry` + `retrieve()`) already exists and is reused twice for non-code corpora (institutional
memory, per-channel brand) via a sentinel "commit" — this is the third instance.

## Decision

- **`server/rag/productKnowledge.ts`** indexes the compiled corpus into `RagEntry` under a GLOBAL scope: a
  reserved sentinel `workspaceId` = the zero ObjectId `000000000000000000000000` (no real workspace) + a
  sentinel `commitHash` = `product-knowledge`. `retrieveProductKnowledge(prisma, query, k)` = `retrieve(...,
  PRODUCT_WS, ..., PRODUCT_COMMIT)`, excluding a meta/marker row. Reuses the one embedder + the one cosine
  scan — no parallel retrieval path.
- **Idempotent on the corpus hash.** A marker row (`__product_meta__`) records the indexed hash; the boot
  `ensureProductKnowledge` re-embeds only when the corpus changed. Indexed once at boot, leader-gated + delayed
  so leadership has settled; best-effort (never blocks/breaks boot).
- **Deterministic + offline-testable.** In the default test world the LOCAL embedder (no GEMINI key) is used,
  so the E2E is deterministic and free: "can I edit videos?" retrieves the media/timeline-editor chunk.

## Rejected alternatives

- **Per-workspace duplication of the corpus.** The corpus is identical for every tenant; a single global
  sentinel scope avoids N copies and re-embeds once. `retrieve`'s mandatory `workspaceId` is satisfied by the
  sentinel; the wrapper hides it.
- **A new store / a parallel retrieval path.** `RagEntry` + `retrieve()` already model exactly this (proven by
  the memory + brand corpora). A second store would fragment the RAG + miss the future `$vectorSearch` swap
  (ADOPTION N3) that this corpus inherits for free.
- **Always re-embed at boot.** Wasteful when the corpus is unchanged (and a paid Gemini batch when keyed); the
  hash marker makes boot a no-op in the common case.

## Consequences

- The product's self-knowledge is now retrievable through the same API the code-RAG uses, globally and
  idempotently. Q3 wires `retrieveProductKnowledge` into `workspaceChat` (+ `workspaceAiPrefix`) so the AI
  actually answers from it. Proven E2E (8/8) against real Mongo + the local embedder: index → the video-edit
  query returns `cap-001`, the marker is excluded, ensure() is idempotent on the hash.
