---
title: Cross-workspace copy — copy styles + brand between workspaces (R2)
status: accepted
date: 2026-07-07
tags: [reuse, workspaces, templates, freedom-program]
---

## Context

FREEDOM_PROGRAM item **R2**. Customization was `workspaceId`-locked: even with the R1/R3 export/import, moving a
style library + brand kit between two of the user's OWN workspaces meant a manual export-download-import round
trip. A direct "copy to another workspace" was missing.

## Decision

- A `copy-workspace-assets` control-op (workspaceSettings) that copies the user-authored styles + the brand kit
  FROM a source workspace INTO the active one, **reusing** `exportStyleSet`/`importStyleSet` (R1) +
  `exportBrandKit`/`importBrandKit` (R3). The Conductor authorizes the **source** side too — the acting user
  must be a member of the workspace they copy FROM (not just the target the RBAC already gates).

## Rejected alternatives

- **A full workspace clone (pipeline + automations + members).** R2 also mentions clone-workspace; the
  styles+brand copy is the self-contained, immediately-useful slice built on the R1/R3 primitives. Pipeline +
  automation-set copy + a "new workspace from existing" bootstrap are follow-ups.
- **Trust the target RBAC alone.** That would let a member of workspace B pull assets from ANY workspace by id.
  Authorizing the source membership in the Conductor closes that.

## Consequences

- A user can copy their styles + brand from one workspace to another in one action (`copyWorkspaceAssets` 3/3,
  incl. the non-member-source refusal). This + R1 + R3 give the "customization isn't trapped" story its
  cross-workspace reach. The full clone + the apply-in-UI buttons are follow-ups.
