---
title: Style-set portability — export/import a workspace's user styles as JSON (R1, style slice)
status: accepted
date: 2026-07-07
tags: [styles, templates, reuse, portability, freedom-program]
---

## Context

FREEDOM_PROGRAM item **R1** (save-as-template + apply). A workspace's user-authored `StylePreset` set was
`workspaceId`-locked — no way to reuse a curated style library in another workspace. (The brand half of this
reuse story shipped as R3/ADR 0128.)

## Decision

- A pure `parseStyleSet(raw)` validates a portable style JSON array (drops malformed entries; a missing label
  defaults to the key). `exportStyleSet(ws)` returns the workspace's **non-builtin** styles (no
  ids/timestamps/workspaceId); `importStyleSet(ws, raw)` upserts them by `feature`+`key` — never touching the
  builtin global defaults. Two membership-gated `_api` routes (`styleExport`/`styleImport`) carry the JSON.

## Rejected alternatives

- **Export builtins too.** The global defaults already exist in every workspace; exporting them would create
  duplicates on import. Only the user's own styles are portable.
- **A full "pipeline + style + brand + automation" mega-template now.** R1 lists several capture targets; brand
  (R3) + styles (this) are the two cleanest, self-contained, round-trippable units. Pipeline + automation-set
  capture (which touch stage config + trigger definitions) are follow-ups toward the full save-as-template.

## Consequences

- A user's style library round-trips losslessly between workspaces (`styleSetPortability` 8/8; builtins
  excluded; re-import idempotent). Together with R3 (brand) this covers the two highest-value template targets.
  The apply-in-UI buttons + pipeline/automation-set capture are follow-ups.
