---
id: 0299
title: Compose-runner deadlines include the public reverse proxy
status: accepted
date: 2026-07-23
tags: [compose, incus, nginx, timeout, operations]
supersedes: []
---

# 0299 — Compose-runner deadlines include the public reverse proxy

## Context

ADR 0298 sized the Pi's first timeout ladder from an early cold-provision observation. Repeated acceptance runs
appeared to cross twenty minutes and exposed two omitted failure modes: nginx stopped waiting after 700 seconds,
and an authenticated healthy agent could be ignored when the preceding Incus exec transport reported non-zero.
The controller continued working after the caller had already received 504. Both defects are fixed; the wider
ladder remains a conservative budget for contended directory storage.

## Decision

- Use measured Pi deadlines of 25 minutes for VM provisioning, 27 minutes for the controller request, and 29
  minutes for the app client.
- Keep the public runner proxy outside that ladder at 1900 seconds.
- Treat the order `provision < controller < app < public proxy` as an operational invariant.
- Keep new-VM host allocation serialized; parallel API acceptance does not bypass the allocation lock.

## Rejected alternatives

- **Leave nginx at 700 seconds:** rejected because it creates false failures and cleanup races while provisioning
  continues.
- **Use an unbounded request:** rejected because a broken clone/agent must eventually release controller capacity.
- **Provision new VM identities concurrently:** rejected because IP/full-clone allocation is deliberately serialized
  and one controller replica is the current safety boundary.

## Consequences

- `deploy/nginx/workspaces-compose-runner.conf` is now a canonical deployment artifact rather than manual host state.
- Operators on faster storage may lower the values only after measuring their own cold and contended clone tails.
- Long-running acceptance scripts must budget for serialized cold allocations.
