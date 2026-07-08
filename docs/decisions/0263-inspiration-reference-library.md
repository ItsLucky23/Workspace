---
title: Inspiration/reference library — collect examples the AI emulates
status: accepted
date: 2026-07-08
tags: [content, rag, inspiration, references, ai-libraries-accounts]
---

## Context

Styles say HOW output renders and the best-practices playbook says what works in GENERAL, but there was no way
for a workspace to say "make it like THESE examples" — the great ads/thumbnails/intros they've collected. That
concrete, per-workspace inspiration was missing.

## Decision

- **A `ReferenceExample` model** (kind, title, `description` = why it works, optional `assetUrl`, tags). The
  human-written `description` is the grounding signal: a text model can't see the asset, so the "why it works"
  IS the inspiration; the asset is the visual shown in the library.
- **Per-workspace RAG under commit `reference`** (`server/content/referenceLibrary.ts`) — mirrors brandMemory:
  one embedder, one `retrieve()`, indexed INCREMENTALLY (add → embed one row keyed by the example id; delete →
  remove that row). No global corpus (inspiration is the workspace's own).
- **`generateScript` grounds on it**: retrieves the top-2 examples relevant to the brief and injects them as
  "Reference examples … emulate the APPROACH/structure, do NOT copy verbatim", alongside best-practices + brand.
- **Ops** `reference-add`/`reference-delete` (content-* family, RBAC); the asset uploads via the existing media
  upload route → `assetUrl`. The snapshot exposes `content.references` for the library UI.

## Rejected alternatives

- **Bundle scraped example ads/thumbnails.** Copyright risk; instead a workspace uploads its OWN license-clean
  examples (or describes patterns in text). The corpus is per-workspace, user-owned.
- **Store references only as images (no description).** A text model can't learn from pixels; the description
  carries the transferable structure, so it's required and is the retrieval key.
- **A global reference corpus (like the playbook).** Inspiration is specific to a workspace's brand/taste, so
  it's per-workspace; universal craft already lives in the playbook (ADR 0262).

## Consequences

- A workspace collects its own inspiration and the content AI grounds generation on the most relevant examples.
  Proven E2E (8/8): add persists + indexes, a brief retrieves the example, the snapshot exposes it, delete
  removes + de-indexes. The library management UI + the file-upload wiring land in the accounts/libraries UI
  pass. Together with styles (how) + the playbook (what works), references (like these) complete the grounding.
