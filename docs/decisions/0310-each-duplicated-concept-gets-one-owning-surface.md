---
id: 0310
title: Each duplicated concept gets one owning surface
status: accepted
date: 2026-08-17
tags: [ia, ux, ownership, content, budgets]
supersedes: []
---

## Context

The UI audit (`src/workspaces/_docs/UI_AUDIT_2026-08-17.md`) found ten concepts implemented on more
than one screen with no stated relationship. The owner could see the symptom on one of them (an "AI
persona" field on every pipeline stage plus a global system prompt on `/workspace`) and asked what
the rest were. Common failure shape: two screens write the same record through different paths, and
neither mentions the other, so a user cannot tell whether editing here changes something there.

ADR 0308 settled the AI-prompt case. This decision settles the remaining six the owner ruled on.

## Decision

**One owner per concept, and the non-owner says so on screen.**

1. **Budget caps** — `insights/usage` owns them. Caps become deletable, and the near-cap alert now
   evaluates *every* named cap and names which one is over. The content header chip and the content
   Admin tab link to the owner. (This one also carried a real bug: the alert watched only the legacy
   single `budget`, so a secondary named cap could run to its limit silently — the exact case caps
   exist to prevent.)
2. **Context documents** — `develop/sources` owns them; the `aiEditable` toggle is removed from the
   workspace-settings starter-doc list, which now links out. They also get archive + confirm-gated
   delete, mirroring `content/documents`.
3. **Brand library** — "Use as brand" overwrites, but only behind a confirm showing a before/after
   field diff, with provenance ("last set from …") on the central panel.
4. **Channel brand voice** — Content settings → Channels owns it; the Insights BrandCard becomes a
   read view with "Edit full channel →".
5. **Account settings** — `/settings` is canonical (ADR 0309); the Workspaces Account tab is a
   summary that links there.
6. **Answers inbox** — shows the real count of open questions per ticket.
7. **Knowledge graph** — stays deliberately small (capped nodes, list view on phone, static ring)
   rather than growing pan/zoom.

## Rejected alternatives

- **Keep both surfaces editable, wired to the same op.** Rejected for every case: identical
  behaviour in two places still leaves the user asking whether it is really the same setting. The
  cost of the duplication is cognitive, not technical, so sharing the write path does not pay it off.
- **Merge the duplicate surfaces away entirely.** Rejected: each pair exists because the concept is
  genuinely *relevant* in two workflows (you want to see a channel's voice next to its results, and
  edit it next to its sibling settings). Read-here / edit-there keeps the relevance without the
  ambiguity.
- **Document the relationships in the docs instead of the UI.** Rejected on the same grounds as
  ADR 0308: a user editing seven stages does not read the docs, and the composition has to be
  verifiable on the screen where they are typing.
- **Budget caps: fix only the alert bug and leave caps undeletable.** Rejected — the list would
  accumulate dead caps, and deletion is a small op alongside the fix.
- **Knowledge graph: invest in pan/zoom + fit-to-view.** Rejected for now; no auditor found the
  canvas doing work a list could not, and the keyboard/touch fixes were required either way.

## Consequences

- Every non-owning surface now carries an explicit "edit it over there" affordance. If a future
  feature adds a third editor for one of these, it inherits that obligation.
- Context-doc archive/delete (point 2) is only half-built: the UI half landed, the persistence half
  did not. It needs an `archived` field on the `InfoSource` Prisma model plus new archive/unarchive/
  delete control ops registered in the op catalog, RBAC and the Conductor (invariant B-23 — the
  Conductor is the only writer). That is a schema migration, which is a developer action, so it was
  deliberately not attempted inside an autonomous run.
- Document AI turned out to be genuinely independent of the per-feature provider registry rather
  than a duplicate; it now says so on screen instead of leaving the user to guess.
