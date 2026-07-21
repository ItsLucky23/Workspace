---
id: 0287
title: Host administration, workspace governance, and browser terminals are separate fail-closed security planes
status: accepted
date: 2026-07-21
tags: [security, rbac, tenancy, superadmin, terminal, containers]
supersedes: []
---

# 0287 — separate host, tenant, and container-terminal authority

## Context

The application had three authority leaks:

1. Workspace owner/admin terminology was being treated as a possible future host-admin shortcut even though
   membership is tenant-scoped. A self-host operator needs a separate global role.
2. The browser terminal still had a development fallback that spawned a shell in the application/host process,
   and its container mode trusted a client-provided Docker name after checking only that it had *some*
   Workspaces label. The ticket detail panel omitted the name and therefore selected the host fallback.
3. Member governance had coarse checks: accepting a workspace suggestion was marked login-only; a
   manageMembers role could invite/remove built-in admins; `ownerActions` on a custom role could reach
   ownership transfer; repeated invite/suggestion actions were not uniformly idempotent.

## Decision

- The framework-global `User.admin` field means **host superadmin only**. It is never inferred from
  `WorkspaceMember.roleKey`. Workspace `owner`/`admin` remains full authority only within that workspace.
  Root operators can bootstrap/recover the host role with `WS_SUPERADMIN_EMAILS`; all host-plane routes must
  use the shared `isHostSuperadmin`/`assertHostSuperadmin` guard. A host superadmin does not implicitly become
  a workspace member either.
- Browser terminals are **container-only in every environment**. The host-shell backend and its env bypass are
  deleted. The client sends workspace id + ticket key, not a Docker name. The socket authenticates itself,
  checks `workTickets`, derives the canonical container and verifies both immutable workspace/ticket labels.
  Host superadmin status does not bypass this product-terminal boundary.
- Workspace governance remains in the Conductor. Suggestions require `workTickets`; owner assignment is only
  possible through compare-and-set ownership transfer by the actual current owner; built-in admin promotion /
  demotion requires its dedicated capabilities; invite role grants cannot exceed the inviter; invite acceptance
  is email-bound and upsert-idempotent; suggestion acceptance claims only an open suggestion.

## Rejected alternatives

- **Treat every workspace owner as host admin.** Rejected because one tenant would gain authority over other
  tenants and the self-host control plane.
- **Keep a dev-only host terminal behind an environment flag.** Rejected because development credentials and
  source are valuable, deploy mode can be misconfigured, and one omitted client field already selected it.
- **Let the browser choose a labelled container.** Rejected because a label-presence test still permits a
  cross-workspace container name.
- **Rely on UI hiding for owner/admin actions.** Rejected because sync/API calls are directly forgeable.

## Consequences

- Operators must set `User.admin=true` or configure `WS_SUPERADMIN_EMAILS` before using future host-plane tools.
- A workspace owner needs normal membership/capability checks and can never open an app/host shell.
- Terminals only become available after the exact ticket container exists; a missing/mismatched target fails
  closed instead of opening another shell.
- Existing clients keep the `ws-term:*` transport but must send workspace/ticket identity.
- Future host-admin UI/API work has one explicit guard and must add host-level audit records; it must not reuse
  workspace RBAC.
