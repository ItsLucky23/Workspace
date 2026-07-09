---
title: H1 — an append-only admin/security audit log for governance ops
status: accepted
date: 2026-07-08
tags: [governance, audit, security, team-trust, adoption, schema]
---

## Context

The team-readiness audit found the #1 admin-trust blocker: governance ops — `change-role`, `save-env`/
`remove-env`, `remove-member`, `transfer-ownership`, `delete-workspace`, `role-update`, `invite` — mutated
authoritative state but left **ZERO** trace (no `AuditLog` model; `recordTicketEvent` needs a ticketId, so
non-ticket governance events were invisible). An admin could not answer "who changed this person's role / read
this secret / removed this member / transferred ownership, and when." For a self-hosted tool that writes code +
holds secrets, that's a hard "no" at many orgs.

## Decision

- **A dedicated append-only `AuditLog`** (`{workspaceId, actorId, action, target, metadata, createdAt}`), separate
  from `TicketEvent` (which is per-ticket + seq-ordered). A pure `recordAudit(prisma, ws, actorId, action, target?,
  meta?)` helper — best-effort (a failure NEVER breaks the op; the authoritative write already ran) — is called at
  the END of each governance conductor case, on the Conductor (the only writer, B-23).
- **Never log the secret VALUE** — `save-env` records the KEY + `{secret: true}`, never the plaintext; the metadata
  carries only safe context (old→new role, invited email + role).
- **A read view** (`listAuditLog` + `audit-log_v1` `_api`, `workspaceSettings`-gated) returns the entries
  newest-first with the actor's name resolved, tenant-scoped.

## Rejected alternatives

- **Reuse `TicketEvent`.** Rejected: it requires a `ticketId`; governance ops have no ticket. A separate log is the
  right home + keeps the ticket timeline clean.
- **Log inside each op's own return.** Rejected: a centralized `recordAudit` at each case's tail is uniform + can't
  be forgotten per-field; best-effort so it never gates the op.
- **Log the full before/after (incl. secret values).** Rejected: an audit log that stores secrets is itself a
  breach surface; the fact + key is enough for "who did what".

## Consequences

- `delete-workspace` records the intent BEFORE the cascade, but the row is deleted WITH the workspace (it lives
  under the tenant) — a durable cross-tenant sink for deletion events is a noted follow-up.
- Backed by `auditLog.test.mts` (10 assertions: each governance op records, the secret value is absent, the view
  resolves actor names + is newest-first). More ops can adopt `recordAudit` as they're added.
- Complements H2 (per-user spend) / H4 (data export) / H5 (fairness) as the governance layer; H3 (SSO/2FA) was
  scrapped (framework-level later).
