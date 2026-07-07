---
title: Undo — content-unarchive (soft-undo) + content-unpublish (retract a post) (S2)
status: accepted
date: 2026-07-07
tags: [content, publish, undo, safety, freedom-program]
---

## Context

FREEDOM_PROGRAM item **S2**. Archiving a piece and publishing a post were one-way: no restore, no retract. A
safety net for reversible actions was missing.

## Decision

- `content-unarchive` sets `archived: false` (a soft-undo — the row was never deleted; archive is a flag).
- `content-unpublish` flips the matching **done** `PublishJob` (by `assetId` + `platform`) to `unpublished` +
  broadcasts content-dirty. Both are `workTickets`-capability control-ops on the single-writer chain.

## Rejected alternatives

- **Hard-delete on unpublish.** A retracted job is kept as an audit record with a distinct status — you can see
  it WAS published then retracted, not that it never happened.
- **A real platform delete on unpublish now.** There is no platform delete adapter (publishing itself falls back
  to a stub); calling the platform's delete API is a follow-up. Today unpublish retracts OUR record + realtime
  state, which is the reversible-state half.
- **Refund the spend.** Spend is monotonic by design (SpendRecord is append-only); refunds are out of scope —
  flagged here so it's a conscious boundary, not an oversight.

## Consequences

- Archive is now reversible, and a published post can be retracted in the app (`contentUndo` 3/3, and a
  different platform's job is left untouched). A global "undo" toast for reversible ops + the real platform
  delete are follow-ups on top of these ops.
