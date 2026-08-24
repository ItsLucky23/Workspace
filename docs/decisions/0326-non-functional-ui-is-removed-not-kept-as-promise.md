---
id: 0326
title: Non-functional UI is removed, not kept as a promise
status: accepted
date: 2026-08-24
tags: [ux, honesty, pipeline, cleanup]
supersedes: []
---

## Context

A 2026-08-23 audit found UI that promised behavior nothing implemented: the per-stage Network
(egress) panel, the capability-skills layer (Sources › Skills, stage skill pickers, used-by-stages
chips), the command-mode 'Ask' tier, the integrations Read/Write tier switch (read-only was simply
not mounted), a budget model-dropdown, commit-signing toggle, ticket viewers, a coming-soon search
banner, and four dead control-ops (content-reorder-beats, gitlab-verify, raise-cap,
copilot-propose). The owner ruled: *"alle UI die niet functioneel is en die … niet nuttig zou zijn
als die functioneel is eruit halen"* — and for egress explicitly "alleen weghalen" (keep only a
read-only host-posture panel).

## Decision

Delete non-functional UI rather than keeping it as an aspirational control. A control that renders
but does nothing teaches users the app lies; honesty beats surface area. Concretely: the frozen op
surface shrank by the four dead ops; CommandMode is `'allow' | 'deny'` (legacy 'ask' rows read back
as deny — nobody sits at the container PTY to answer); a mounted tool IS full access (the toggle is
the mount; legacy 'ro' rows read as off); egress posture is a read-only host panel fed by the
`egressStatus` API. Non-functional-but-useful candidates (maxTurns wiring, pauseAll enforcement,
prompt-experiments, …) are REPORTED to the owner for a conscious build/delete decision, not silently
rebuilt.

## Rejected alternatives

- **Disable/grey-out instead of delete** — a permanently disabled control still reads as "coming",
  which is the same lie with extra chrome.
- **Building the missing backends first** — each was individually judged not worth its complexity
  (per-stage egress rules, per-stage skill gating, an interactive command-approval loop).

## Consequences

- EffectMatrix keys equal ENABLED_OPS exactly; the removed ops need no rows.
- Legacy persisted values ('ask', 'ro') are mapped on read, never migrated in place.
- Future feature gaps go through SetupNotice/readiness (explain + fix) instead of placeholder UI.
