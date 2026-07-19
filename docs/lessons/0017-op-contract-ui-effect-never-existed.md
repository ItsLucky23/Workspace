---
id: 0017
title: surfaceReachability pins op ENTRY points, not op EFFECTS — an op's promised UI behavior can be pure prose
severity: medium
area: testing, op-catalog, ui-contracts
date: 2026-07-20
---

# 0017 — the archive that never disappeared

## What happened

The first LIVE use of the newly assistant-enabled `archive` op worked perfectly server-side
(proposal → destructive confirm → Conductor → `archived: true` in Mongo), yet the ticket stayed on
the board — through reloads and across instances. Hours went into suspecting the accept path, the
dispatcher, multi-instance routing and stale snapshots. The DB was right all along: board and
backlog had NEVER filtered `archived === true`. A provider comment even said "the board/backlog
derive visibility from it" — the derivation did not exist, in any historical version.

## Root cause

The op's UI contract ("disappears from the board and backlog, restorable later") lived only in
prose and comments. `surfaceReachability` pins that every op has an ENTRY point (a button, a
dispatcher); nothing pins an op's EFFECT on the screens it claims to change. Because no UI path
actually triggered `archive` until the assistant could, the gap survived every green suite.

## How to avoid

- When enabling an op (assistant or UI), verify its promised EFFECT once in the browser — not just
  that the dispatch fires. The op summary text is a checklist: every claim in it must be
  observable.
- Comments that say "X derives from Y" are hypotheses: grep for the derivation before trusting
  them (here: zero `archived` references in board/backlog across all of git history).
- When a soft-delete flag ships in a snapshot "so the client can filter", add the client filter in
  the same change — a flag without a consumer is the exact pattern the hardening sessions kept
  finding.
