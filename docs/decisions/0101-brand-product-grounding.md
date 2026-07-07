---
title: A persistent brand/product context grounds every creative generation
status: accepted
date: 2026-07-07
tags: [content, ai, branding, freedom-program]
---

## Context

FREEDOM_PROGRAM item **Q2**. The channel brand voice a user typed was indexed into brand-RAG but
`retrieveChannelBrand` was never consumed by any generation (dead), and there was no place to set a
persistent "what we do / who our audience is / always mention X" so the AI stays on-brand. A user had to
retype direction into the free-text extra-instructions box every single time.

## Decision

- A new `Workspace.productContext` field holds the persistent brand/product context, editable in the content
  settings (a new `content-edit-product` control-op, single-writer).
- A single helper `buildBrandContext(prisma, workspaceId, contentProjectId?)` composes the workspace product
  context + the owning channel's `brandVoice` (read directly — deterministic, key-less, always available; not
  the embedding-dependent RAG path).
- It is folded into **every creative generation at one choke-point each**: media via the shared
  `runQueuedMediaAsset` helper (grounds all image/video/3d/voice/music/sfx/reference flows) + `composeMediaPrompt`
  (prepended first); text via `generateScript`'s system prompt.

## Rejected alternatives

- **Wire the RAG `retrieveChannelBrand`.** It needs an embedding provider/keys and adds retrieval latency for a
  short, always-relevant snippet. A direct field read is deterministic, key-less, and grounds every gen without
  a vector round-trip. (RAG grounding for larger uploaded docs is a separate item, K3.)
- **Per-generation only (extra-instructions box).** That is one-shot and must be retyped each time; a persistent
  workspace field is the "set once, applied everywhere" the user wanted.
- **Thread brandContext through every flow's request by hand.** The shared queued helper is the single media
  choke-point (post the earlier refactor), so one wiring point covers all media flows.

## Consequences

- Set the context once → every script, image, video, voice, etc. is on-brand automatically. The caller can
  still override per request (the request's own `brandContext` wins).
- The channel brand voice a user types now actually reaches generation (was dead). Larger bring-your-own-doc
  grounding (RAG) remains K3.
