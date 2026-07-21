---
id: 0290
title: Tenant-scoped proxy, media and egress boundaries
status: accepted
date: 2026-07-21
tags: [security, tenancy, proxy, media, egress]
summary: Dynamic routes and unsigned media resolve to one workspace, while production worker egress and every attached proxy network fail closed.
---

## Context

Ticket keys, branch names and service names are unique only inside a workspace. Using those values as global proxy ids/hosts allowed one tenant's upsert to replace another tenant's route. Unsigned media reads required membership in any workspace rather than ownership of the file's workspace. Worker egress confinement was opt-in and could be bypassed by later attaching the worker to a normal proxy network.

## Decision

Generated preview, ref-preview, editor and environment route ids/hosts include the workspace id. Custom domains and subdomains are globally collision-checked. Edge auth continues to resolve host ownership through Redis and requires the route workspace's capability.

New local media files receive a filesystem ownership sidecar when promoted or generated. Unsigned downloads require membership in that exact workspace; legacy generated files may resolve ownership only through tenant-bearing database rows. Valid short-lived HMAC links remain the deliberate cookie-less path for publishing platforms and public pages.

Production defaults `WS_EGRESS` to enforcement. Any secondary network attached to a confined worker must be Docker-internal; an existing externally routed proxy network fails closed. The production bootstrap creates `workspaces-net` as internal.

## Rejected alternatives

- **Rely on globally unique ticket/branch names:** the data model explicitly scopes them per tenant.
- **Allow any authenticated workspace member to read any media UUID:** UUID secrecy is not tenant authorization.
- **Constrain the launch network but attach a normal proxy bridge later:** Docker would route directly through the second network and bypass Squid.
- **Keep production egress report-only:** reporting does not prevent code or secret exfiltration.

## Consequences

- Generated preview/editor URLs change and old unscoped routes are not reused.
- Legacy media without a sidecar or recognized tenant row fails closed.
- Existing production `workspaces-net` networks must be recreated as internal before bootstrap succeeds.
- Live Docker and external-network behavior still requires infrastructure verification; repository tests prove only command/policy construction.
