---
title: Guided first-run setup wizard (S3, wizard half)
status: accepted
date: 2026-07-08
tags: [ux, onboarding, freedom-program]
---

## Context

FREEDOM_PROGRAM item **S3**. Configuration was forms-only — a new user had to find the media-key + budget
settings across tabs to reach a working state.

## Decision

- A `SetupWizard` stepper (welcome → connect a media key → set a spend budget): each step fires the SAME
  single-writer control-op as the settings UI (`saveMediaProvider({ apiKey })` / `editMediaBudget`). The wizard
  is a friendlier front door, never a new writer. Opened from a "Quick setup" button on the workspace settings
  header.

## Rejected alternatives

- **A parallel setup writer.** The wizard reuses the tested settings ops — no new op, no bypass of RBAC /
  single-writer.
- **Ship the NL-Assistant-configures-settings path in the same pass.** The other half of S3 (the chat Assistant
  proposing settings ops from natural language) needs the Assistant's op vocabulary extended to the settings
  ops + the propose→accept flow — a follow-up. The stepper delivers the "connect a key + budget" Verify now.

## Consequences

- A new user reaches a working workspace (key + budget) in two steps without hunting through the forms. The
  wizard is browser-verified; the ops it fires are already tested. Auto-opening it on first run + the NL-Assistant
  configuration path are follow-ups.
