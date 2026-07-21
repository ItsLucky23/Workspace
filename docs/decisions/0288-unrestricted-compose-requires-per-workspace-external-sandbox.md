---
id: 0288
title: Unrestricted Docker Compose runs only on an external per-workspace sandbox
status: accepted
date: 2026-07-21
tags: [docker, compose, security, tenancy, isolation, self-hosting]
supersedes: []
---

# 0288 — unrestricted Compose requires a per-workspace sandbox

## Context

The product must support arbitrary third-party Docker Compose, not only curated presets. The prior YAML
sanitizer rejected privileged mode and obvious binds, but missed parts of long syntax and can never make every
future Compose/Docker feature safe. Conversely, allowing those directives on the application daemon gives a
workspace user root-equivalent access to the Workspaces host. Project-name/network prefixes also do not stop
cross-tenant access on one daemon.

## Decision

- Production never runs workspace Compose on the app Docker daemon. It calls a root-configured HTTPS runner URL
  containing `{workspaceId}`; each resolved endpoint represents a dedicated VM/microVM/physical sandbox.
- Inside that sandbox Compose is unrestricted. Workspaces preserves the raw YAML instead of pretending a
  sanitizer is the security boundary.
- The runner returns explicit gateway/overlay environment values for services needed by app/agent containers;
  Workspaces never assumes same-daemon DNS.
- Missing/invalid runner configuration fails closed in production. Restricted local sanitization remains only
  as a development fallback.
- Conductor owns desired-state persistence and records which backend must handle teardown.

## Rejected alternatives

- **Keep expanding the sanitizer.** Rejected: incomplete by construction and incompatible with “fully free”.
- **Docker-in-Docker or a privileged sidecar on the app host.** Rejected: privileged containers are not a host
  security boundary and preserve an escape path to the operator machine.
- **One remote daemon shared by every workspace.** Rejected: unrestricted Compose can inspect/mount/share other
  tenants' daemon resources and networks.
- **Namespace only with `docker compose -p`.** Rejected: naming prevents collisions, not malicious access.

## Consequences

- Operators must provision the external sandbox layer and configure its URL template/token before production
  Compose is available. This external infrastructure cannot be honestly live-proven by repository-only tests.
- A compromised third-party container can own only its disposable workspace sandbox.
- Development without a runner remains convenient but deliberately restricted.
- Runner quotas, network policy, lifecycle/GC and overlay connectivity are part of the deployment contract in
  `docs/ARCHITECTURE_ISOLATED_COMPOSE.md`.
