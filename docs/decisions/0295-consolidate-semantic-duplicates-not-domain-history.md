---
id: 0295
title: Consolidate semantic duplicates, not domain history
status: accepted
date: 2026-07-21
tags: [data-model, skills, rag, artifacts, migration]
summary: Move workflow capabilities out of InfoSource into canonical Skill rows, while retaining source/history/index and domain-artifact models as explicit layers rather than a destructive mega-table.
---

## Context

The audit found two actual skill stores: instruction skills in `Skill` and workflow capabilities in `InfoSource(mode='skill')`. It also found similarly named brand/style, document/RAG and artifact models. Those latter groups are not interchangeable rows: they represent source versus derived index, identity versus generation preset, or separate lifecycle/retention domains. ADR 0034 already rejected a single artifact mega-table and ADR 0270 kept instruction skills, styles and design artifacts semantically separate.

## Decision

`Skill` is the one skill store. `skillType='instruction'` rows contain reusable prompt instructions; `skillType='capability'` rows retain workflow-tool metadata (`kind`, `model`, `projectId`, `usedByStages`, status/description). Watermarked schema step 6 creates a capability row with `legacyInfoSourceId` before deleting each legacy `InfoSource(mode='skill')`. The frozen `skill-toggle` operation still accepts `sourceId`: it toggles a capability Skill first and falls back to a context-document InfoSource, so no public verb or client contract changes.

The other models remain intentionally layered:

- `Document` is mutable source, `DocumentRevision` is history, and `RagEntry` is a rebuildable derived retrieval index.
- `StudioBrandLibrary` is workspace brand identity; `StylePreset` is a per-feature generation preset.
- `DesignArtifact`, `StudioArtifact`, `BuildArtifact`, `ContentAsset` and document exports keep their domain-specific status, ownership, retention and security contracts. Cross-domain use goes through projections such as ticket-artifact links and generated context, not copied canonical state.

These boundaries are consolidated in service/read projections and documentation, not by erasing lifecycle semantics.

## Rejected alternatives

- **Keep both skill stores:** duplicate toggles, snapshot logic and AI context continue drifting.
- **Move instruction skills into InfoSource:** loses apply-point semantics and confuses documents with executable prompt policy.
- **Merge all artifacts into one table:** weakens domain-specific invariants and repeats the alternative rejected by ADR 0034.
- **Store document content directly in RAG rows:** makes a derived index authoritative and breaks deterministic rebuilds.
- **Merge brand identity with every style preset:** one partial style edit could overwrite workspace-wide voice, typography or palette.

## Consequences

- New and migrated workflow capabilities use `Skill(skillType='capability')`; `InfoSource` is document/context source only.
- Instruction resolution explicitly filters `skillType='instruction'`, preventing capability metadata from entering prompts.
- The migration is idempotent and preserves exact legacy IDs as provenance before deleting source rows.
- Similar names no longer justify destructive model merges; each retained model must have an explicit source/history/index or domain-lifecycle role.
