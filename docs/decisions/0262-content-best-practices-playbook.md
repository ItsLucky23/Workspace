---
title: Best-practices playbook — domain-expertise RAG grounding content generation
status: accepted
date: 2026-07-08
tags: [content, rag, best-practices, ai, ai-libraries-accounts]
---

## Context

The content AI knew what the PRODUCT can do (product-knowledge corpus) and HOW to render (styles), but not
what makes content WORK — hooks, retention structure, thumbnail principles, ad structure, per-platform rules.
So a generated script was on-brand but not necessarily good. Domain craft was missing.

## Decision

- **A curated `docs/content-playbook/playbook.md`** holds platform-agnostic craft knowledge, one retrievable
  chunk per `###` section (hooks, scripts/retention, thumbnails, per-platform, ads).
- **A fourth global RAG corpus** (`server/rag/contentPlaybook.ts`) — same second-corpus pattern as
  product-knowledge/memory/brand: the ONE embedder + the ONE `retrieve()`, global zero-ObjectId sentinel
  workspace, distinct commit `content-playbook`, idempotent on a content hash, boot-ensured leader-gated. The
  markdown is chunked at RUNTIME (no compiled JSON / generator needed — it's small + hand-curated).
- **`generateScript` grounds on it**: retrieves the top-3 best-practices relevant to the brief and injects them
  as a "Proven content best-practices (apply these)" section in the system prompt, alongside brand + knowledge.

## Rejected alternatives

- **Hard-code best-practices into the script prompt.** A static block can't adapt to the brief (a thumbnail
  brief and a LinkedIn brief need different craft) and grows unmaintainable; retrieval surfaces only what's
  relevant and is editable in one markdown file.
- **A compiled JSON + generator (like product-knowledge).** Overkill for a small hand-curated playbook;
  runtime chunking keeps it to one file with no build step.
- **A per-workspace corpus.** Craft best-practices are universal, so the global sentinel corpus (shared by
  every tenant, indexed once) is correct — a workspace's OWN brand voice already grounds via brandContext.

## Consequences

- Generated scripts now ground on proven craft relevant to the brief, not just the ask. Proven E2E (7/7): 11
  chunks index, a hook query retrieves the hooks best-practice, a thumbnail query the thumbnail one, idempotent
  on the hash. The playbook is one editable markdown; adding a section = a new retrievable chunk. Next: the
  inspiration/reference library (example ads/thumbnails the AI emulates) builds on this same retrieval idea.
