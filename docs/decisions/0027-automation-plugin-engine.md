---
id: 0027
title: Automation / plugin-engine — WorkspaceTrigger + ActionExecutor + AgentRole registry
status: accepted
date: 2026-07-03
tags: [workspaces, automation, triggers, plugins, agent-roles]
supersedes: []
---

# 0027 — Automation / plugin-engine

## Context

Goal-item #2. The `WorkspaceTrigger` / `WorkspaceSignal` schema existed but nothing evaluated or
fired triggers, there was no way to run an action on an event/schedule, and no seam to plug in
non-coding agent roles. The user wants: WorkspaceTrigger (event/cron → action, leased scheduler) +
an ActionExecutor with an approval-gate + an AgentRole plugin registry.

## Decision

- **`fireEvent`** (`server/automation/triggers.ts`): when the Conductor raises an engine event
  (`ticket.created` on quick-add, `stage.on_enter` on bulk-move), it finds the enabled triggers that
  match (`on` + a `match` facet: stageIds/statusKeys/projectIds), applies **debounce** (`debounceMs`
  vs `lastFiredAt`) + **cross-instance dedupe** (`dedupeKey` → a Redis once-claim, multi-instance-
  safe), and runs each through the executor's gate. Pure `matchesTrigger`/`passesDebounce` are unit-
  tested. Fired best-effort off the Conductor chain — a bad trigger can't break the event.
- **ActionExecutor** (`server/automation/executor.ts`) with an **APPROVAL GATE**: a trigger whose
  `requiresApproval` is set (or whose agent-role `mutates`) does NOT execute — it opens a
  `WorkspaceSuggestion` (type `automation`) carrying the action in `patch`; a human accepting it
  (`accept-suggestion` → `executeGatedAction`) runs it. This keeps the single-writer invariant
  (B-23): automation PROPOSES, the human consents, the Conductor executes. Concrete actions: notify
  · emit-signal · start-stage (moves the ticket; the #1 watchdog reprovisions it — no engine
  coupling) · invoke-agent-role.
- **Cron** (`server/automation/cron.ts`): a leader-gated per-minute scheduler with a pure 5-field
  `cronMatches` (`*`, `*/n`, `a-b`, `a,b`) firing `on:'cron'` triggers, with a per-minute guard.
- **AgentRole registry** (`server/automation/agentRoles.ts`): `registerAgentRole` / `getAgentRole`
  / `listAgentRoles` — the seam for plugging in additional NON-coding roles (a reviewer, a
  summariser). The code-writing agent stays the one built-in interactive-`claude` role (B-6). A
  role's output is recorded as a notification — the notification bell IS the ArtifactViewer.
- **Management:** `trigger-save`/`trigger-toggle`/`trigger-delete` control-ops (RBAC editPipeline) +
  a `triggerAction` sync route + the triggers in the snapshot + a compact `AutomationPanel` on the
  Pipeline page (list · enable/disable · delete · create with first-class notify/emit-signal/
  start-stage fields). i18n en/nl/de/fr. Richer param editing is a follow-up.

## Rejected alternatives

- **Execute gated actions inline (no suggestion).** Would let automation write authoritative state
  without human consent — violates B-23. The suggestion round-trip is the consent.
- **Couple start-stage to the Conductor's provisioning.** Creates an import cycle; a direct move +
  the #1 watchdog's idle re-provisioning achieves the same, decoupled.
- **A full cron library.** A minimal matcher covers the common schedules with zero dependency; a
  library can replace it later behind the same `cronMatches` seam.
- **Event-fire `run-command` triggers.** A command is an operator-only, mutating action; V1 skips
  event-driven commands (safety) — they remain a gated/manual path.

## Consequences

- Triggers fire on events + schedules; mutating ones gate behind approval; roles are pluggable.
- Verified: `automation.test.mts` (21/21) — matching/debounce/cron (pure), the AgentRole registry,
  and the real pipeline (notify creates notifications, an approval-gated trigger opens a suggestion
  and does NOT execute, accepting it runs the deferred action). Full suite 29/29. Browser: created a
  trigger via the AutomationPanel; a ticket-create fired it → the notify action created the
  notification (full wiring proven).
