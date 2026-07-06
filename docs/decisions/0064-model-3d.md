---
id: 0064
title: 3D-concepting generation (F2.6)
status: accepted
date: 2026-07-06
tags: [content, 3d, media, expansion-f26]
supersedes: []
depends_on: [0049, 0062]
---

# 3D-concepting generation (F2.6)

## Context

3D is the weakest modality (concepting-grade, not hero assets) + lowest priority (ADR 0049). F2.6 adds it as a simple single-asset gen on the shared path — closing Fase 2 (all modalities present).

## Decision

3D generation rides the `content-gen-3d` op (wired in F2.4's shared Conductor case → `generateMediaAsset` with feature `model-3d`, default fal/Meshy-class provider, stub). No new engine code.

## Rejected alternatives

- **A rigging/topology-cleanup pipeline.** Rejected — out of scope; 3D is concepting/previz only (ADR 0049). A dedicated Meshy/Tripo provider + a mesh viewer are follow-ups.

## Consequences

- No new engine code (op wired in F2.4). `tests/integration/model3d.test.mts` (5): a `model-3d` asset (fal), MediaJob linked, budget 20c. **Fase 2 (all modalities) is complete.** F3 adds publishing + automation.
