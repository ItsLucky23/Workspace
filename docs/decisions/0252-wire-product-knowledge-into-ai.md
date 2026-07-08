---
title: Q3 — wire product self-knowledge into the Workspace-AI + every feature
status: accepted
date: 2026-07-08
tags: [ai, rag, self-knowledge, workspace-chat, ai-libraries-accounts]
---

## Context

Q1 compiled the product's self-knowledge and Q2 made it retrievable, but nothing consumed it yet. Q3 wires it
into the in-app AI so it actually answers "can we edit videos?" from the corpus.

## Decision

- **`workspaceChat.interpretChat` retrieves the product corpus** (`retrieveProductKnowledge(message, 4)`)
  alongside the existing code-RAG, and injects it into the system prompt as a SEPARATE "What THIS product can
  do" section — deliberately distinct from the user-code section so the model never confuses product
  capabilities with the user's repository. A new instruction tells it to answer whether/how questions from
  that section (name the module + steps) and, when a first step maps to an op, propose it.
- **A compact global capability index in `registry.workspaceAiPrefix`/`runAiCompletion`** — the capability
  TITLES (not the full corpus), read once from the compiled shard + cached, prepended to EVERY feature's
  system prompt at the single choke-point. So the whole AI surface is product-aware, cheaply (~15 lines), with
  the detail retrieved on demand in chat.
- **B-23 unchanged.** The assistant still only proposes; the Conductor is the single writer.

## Rejected alternatives

- **Bake the whole corpus into the system prompt.** 178 chunks blow the budget; retrieval surfaces the
  relevant few. The prefix carries only titles for awareness.
- **Merge product-knowledge into the code-context section.** The model would conflate "what the app offers"
  with "what the user's repo contains". Separate sections keep the two grounded distinctly.
- **Skip the global prefix (chat-only).** The goal is a product-aware AI everywhere; the title-only index is
  cheap enough to prepend to all text features (designer/script/review) so they too know the surface.

## Consequences

- The Workspace-AI now answers capability/how-to questions from the product's own knowledge. Proven LIVE (5/5,
  real Gemini): "Can I edit videos?" → "Yes, within the media/content module … generate from a brief or upload
  … then the timeline editor" — exactly the intended answer. This completes Fase Q (self-aware AIs). The
  capability Q&A (`docs/product-knowledge/capabilities.md`) is the file to keep current as features ship.
