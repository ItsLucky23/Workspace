---
id: 0045
title: RAG sharpen — institutional memory + wire into surfaces + re-index on merge
status: accepted
date: 2026-07-06
tags: [rag, institutional-memory, retrieve, expansion-e2]
supersedes: []
depends_on: [0041]
---

# RAG sharpen + institutional memory

## Context

The RAG index is already SINGULAR — one `RagEntry` store, one `retrieve()`, one embedder
(`server/rag/{index,embed}.ts`). An earlier fix grounded the Workspace-AI chat. E2 finishes the wiring:
consumption breadth + institutional memory, all on the same index (no parallel store).

## Decision

1. **Institutional memory on the same store.** `server/rag/memory.ts` indexes the workspace's `Handoff`
   (summary/decisions/gotchas/next) + `CarryOver` (summary/open-questions) envelopes into `RagEntry` under
   a reserved sentinel commit `institutional-memory`. `retrieveMemory()` reuses the single `retrieve()`
   with that sentinel — so prior learnings surface via the SAME retrieval path, no second index. Frozen-
   per-"commit" replace (mirrors code indexing). Un-defers `additions/03_institutional_memory`.

2. **Incremental re-index on merge.** A successful `mr-merge` fires a best-effort re-index of the code RAG
   (the target branch advanced) + the institutional memory — off the caller's path, never blocking the
   merge. Previously re-index was manual-only ("Reindex code").

3. **Wire retrieval into more surfaces.** The plan-critique role (E1) now grounds its critique in
   `retrieveMemory()` — repeated past mistakes become the highest-value gaps. (The C3 mr-review role already
   grounds on `retrieve()`.) An `index-memory` control-op (re)builds the memory on demand.

## Rejected alternatives

- **A separate memory index / retrieval path.** Rejected — the whole point is ONE index every AI surface
  uses; a sentinel commit reuses the store + `retrieve()` with zero new plumbing.
- **Index every Handoff on write.** Rejected for now — a batch (re)index on merge + on demand is cheaper
  and keeps the memory a coherent snapshot; a per-write incremental upsert is a later refinement.
- **Auto-inject memory into every stage.** Deferred — the roles that reason (plan-critique, mr-review,
  interviewer) pull memory when relevant; blanket injection would bloat every prompt.

## Consequences

- No schema change — reuses `RagEntry` (the `commitHash` sentinel scopes memory rows).
- `mr-merge` gains a best-effort re-index side-effect; `index-memory` op + `retrieveMemory` are new.
- Plan-critique + mr-review are RAG-grounded; keeping injected code/docs as `InfoSource` (the design-system
  pattern) already makes them visible in Sources.
- Follow-ups: Studio/docs-gen grounding; per-write incremental memory upsert; a Mongo `$vectorSearch`
  swap for the app-side cosine scan when repos grow.
