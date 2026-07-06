---
id: 0067
title: Content automation + conversational entry (F3.3)
status: accepted
date: 2026-07-06
tags: [content, automation, cron, assistant, expansion-f33]
supersedes: []
depends_on: [0049, 0027, 0054]
---

# Content automation + conversational entry (F3.3)

## Context

Two entry modes for content (ADR 0049): recurring channel automation (cron) + a conversational quick-start (the Assistant spins up a piece from a brief). F3.3 wires both, reusing the automation engine (ADR 0027) + the content pipeline (F1.1).

## Decision

1. **A schedulable `content-ideator` AgentRole** (`server/content/ideatorRole.ts`, `mutates:true`). A cron trigger (`action:'invoke-agent-role', params:{role:'content-ideator', theme?}`) fires it; because it `mutates`, the automation executor GATES it into an approval suggestion — it never writes content directly (B-23). Registered at boot in `server.ts`.
2. **A `content-from-brief` op** (B-23, `workTickets`) — the conversational quick-start: creates a content-lane `Project` + a first `ContentProject` piece from a chat brief in one op (on the user's accept). This is what the Assistant calls to "spin up a video about startup A".

## Rejected alternatives

- **A dedicated content-cron model + scheduler.** Rejected — the existing `WorkspaceTrigger` + cron + `invoke-agent-role` (ADR 0027) already schedules roles; content reuses it (no new verbs).
- **`content-ideator` as `mutates:false` (→ notification).** Rejected — a proposed content idea is a write path; `mutates:true` forces the approval gate (the man-in-the-middle only approves), matching B-23.
- **The Assistant writes the content project directly from chat.** Rejected — LLMs never write authoritative state; the Assistant calls the `content-from-brief` control-op (Conductor writes), on the user's consent.

## Consequences

- New `server/content/ideatorRole.ts` (registered in `server.ts`) + the `content-from-brief` op. Closes Fase 3 (publishing + automation). F4 builds the UI (board/pipeline/settings/copilot) on top.
- `tests/integration/contentAutomation.test.mts` (7): a scheduled content role is gated to a suggestion with NO direct content write; `content-from-brief` spins up a content project + piece carrying the brief. rbac 122/122.
