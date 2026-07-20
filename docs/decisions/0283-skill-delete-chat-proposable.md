---
title: ai-skill-delete is chat-proposable — the owner overrules the UI-only pin
status: accepted
date: 2026-07-20
tags: [workspace-ai, chat, op-catalog, skills, b-23]
supersedes: []
---

# Context

ADR 0282's parity tranche initially enabled `ai-skill-delete`, was caught by the couplingBridges
pin ("deleting a user-authored skill from a chat turn stays a UI-only action") and reverted,
leaving the flip as an explicit open owner call.

# Decision

The owner decided (2026-07-20, verbatim: "skills verwijderen mag de AI ook"): `ai-skill-delete`
is `enabled` in the propose catalog, mirrored in `CHAT_ENABLED_OPS`, with its dispatcher on the
existing `workspaces/skillsControl` route. It stays `destructive: true`, so the accept path keeps
the mandatory extra confirm (B-23: propose → accept → confirm → RBAC → Conductor).

# Rejected alternatives

- Keeping the UI-only pin: the owner explicitly overruled it; toggle-off as the only chat path
  forced a screen visit for an action the confirm flow already guards.

# Consequences

- couplingBridges now pins the ENABLED mode + the destructive flag; opCatalogParity's tranche
  table covers the op's reference validation again (dangling skillId → degrade to reply-only).
