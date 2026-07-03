---
name: rag-codebase-intelligence
title: RAG codebase intelligence — pluggable embeddings + a cosine-scan retrieval injected into the agent context
status: accepted
date: 2026-07-03
deciders: [ItsLucky23]
tags: [rag, ai, retrieval, orchestrator, engine]
supersedes: []
relates: [0007, 0008]
---

## Context

The AI stage-agent saw only wholesale context-docs (starter guidance + the ticket's selected docs) —
it had NO view of the actual codebase it was about to change beyond exploring blind. The handoff
(07 §D) specs a RAG layer, and the schema already had the store (`RagEntry`: commitHash+filePath+
chunkId, `embedding Json?`, app-side-cosine fallback) — but no indexer, no embedder, no retrieval
step. This ADR records building that pipeline.

## Decision

- **Pluggable embeddings** (`server/rag/embed.ts`, mirroring the AI-provider abstraction, ADR 0007):
  Gemini's embeddings API when `GEMINI_API_KEY` is set, else a deterministic LOCAL embedder (hashed
  token + char-trigram bag, L2-normalised) so retrieval works fully offline and in tests. A lexical-
  semantic proxy that is genuinely useful for code (identifier/symbol overlap). The active embedder
  is fixed per deployment, so index-time and query-time vectors are always produced the same way; it
  is stamped via `embedTag()` so a later switch is detectable.
- **Indexer + retrieval** (`server/rag/index.ts`): `indexWorkspace` reads the linked repo's code at a
  commit (`repoStore.listRepoFiles`, from the bare clone, no checkout), chunks it line-aligned,
  embeds each chunk, and upserts `RagEntry` frozen-per-commit (re-index replaces that commit's rows).
  `retrieve` embeds a query and returns the top-K by an app-side cosine scan over the stored vectors.
- **Injection**: `stageRunner` retrieves the code most relevant to the ticket (title+description,
  scoped to the ticket's frozen `commitHash`) and feeds it to a new `renderStage` "Relevant code from
  the repository" section in `CLAUDE.md` — so the agent starts with the right files in view.
- **Trigger**: a `scan-index` control-op (mirrors `scan-docs`) + `_sync` route + `editPipeline` cap,
  so a user reindexes from the Sources page; the engine also retrieves automatically per turn.

## Rejected alternatives

- **Require an external embedding service.** Rejected as the default — it would make RAG depend on a
  key being present. The local embedder makes RAG always-on + testable; Gemini is the quality upgrade.
- **Atlas `$vectorSearch` now.** Deferred — an app-side cosine scan over the bounded per-commit index
  (≤600 files) is cheap and has zero infra setup. `$vectorSearch` is a drop-in swap in `retrieve` when
  index size warrants it (the embeddings are already stored in the shape it needs).
- **Full-file wholesale injection.** Rejected — that is what context-docs already do and it blows the
  context budget; retrieval is the missing hop that gives the agent the RIGHT files, not all of them.

## Consequences

- The stage-agent now opens each turn with the code most relevant to its ticket (proven ranking:
  `scripts/spike/ragSpike.mts` — an auth query returns `auth.ts` on top, a db query `db.ts`).
- Re-index is frozen-per-commit, so parallel tickets on different baselines keep distinct indexes.
- Embedding quality is lexical without a Gemini key (good for code, weaker on pure natural-language
  paraphrase). Setting `GEMINI_API_KEY` upgrades it; a `WS_EMBED_MODEL` override is available.
- Follow-ups: incremental per-changed-file delta re-index (currently a full re-index per commit),
  importer-propagation, and the `$vectorSearch` swap at scale.
