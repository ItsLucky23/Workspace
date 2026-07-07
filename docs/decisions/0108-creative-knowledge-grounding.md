---
title: The creative AI grounds on the user's enabled context-docs (deterministic, key-less); semantic RAG is a follow-up
status: accepted
date: 2026-07-07
tags: [content, knowledge, rag, freedom-program]
---

## Context

FREEDOM_PROGRAM item **K3**. RAG retrieval was walled off from the creative features — only the dev
stage-agent + reviewers called `retrieve()`; `script`/designer/marketer had no access to the user's uploaded
docs (K2) or repo docs. So a user could upload house-style/product docs and the content AI still ignored them.

## Decision

- A `buildKnowledgeContext(prisma, workspaceId)` helper folds the workspace's **enabled** context-doc
  InfoSources (bounded: 2000 chars/doc, 6000 total) into a labelled grounding block, and `generateScript`
  prepends it (alongside the Q2 brand context). Deterministic + **key-less** — no embeddings needed; the user's
  enabled docs steer the script.

## Rejected alternatives

- **Wire semantic RAG `retrieve()` into the creative flows now.** Needs an embedding provider/keys and ranking;
  the enabled-docs injection is the always-works baseline that delivers "the AI uses my docs" today. Semantic
  ranking (most-relevant chunks for THIS prompt) is a documented follow-up on top of this.
- **Inject into media (image/video) prompts too.** A long house-style doc is noise in an image prompt; knowledge
  grounding is scoped to text creative. (Media stays on the Q2 brand context.)
- **Ground ALL context-docs regardless of the enabled flag.** The `enabled` toggle is the user's opt-in per doc
  (same as the dev side) — respect it.

## Consequences

- A user's uploaded/scanned docs now actually steer script generation. Extending the same helper to the Studio
  marketing/design text features + adding semantic (RAG) retrieval + a per-generation source-attach picker are
  documented fast-follows (the helper is the seam). Bounded so a large library can't blow the prompt.
