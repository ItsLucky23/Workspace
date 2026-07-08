---
title: K1 — third-party services via a sanitized, per-workspace-namespaced docker-compose engine
status: accepted
date: 2026-07-08
tags: [container, services, compose, security, multi-tenancy, adoption, schema]
---

## Context

There was NO way to attach a third-party service (Postgres/Kafka/Redis/Elasticsearch) to a workspace — the
"catalog" only stored a connection string + a (missing) MCP script and provisioned nothing. The user wants "run
any docker-compose" so ANY tool is reachable, and correctly noted that running the services is just
`docker compose up` — the real edges are multi-tenancy + security.

## Decision

- **A compose-ENGINE, not a fixed catalog.** A workspace attaches an arbitrary docker-compose file
  (`service-provision` control-op). K2 presets are curated compose snippets on top; the engine is the core.
- **Fail-closed SANITIZER (K1-a, `composeSanitize`)** gates every compose before it is stored or run: host-escape
  directives (`privileged`, `cap_add`, `devices`, `security_opt`, host bind-mounts, `/var/run/docker.sock`,
  `network_mode|pid|ipc: host`) REJECT the file (structural parse via the dep-free `parseYamlSubset` + a raw-text
  scan that catches flow-style); published host ports are REWRITTEN to container-only (no cross-workspace port
  collision — services are reached intra-network by name).
- **Per-workspace namespacing (K1-b, `composeEngine`)**: the compose runs under project `ws-<id>-<name>` on an
  EXTERNAL per-workspace network `ws-<id>-svc` injected into the compose (so the app/preview container + the
  services share one net); Docker prefixes volumes by project. Two workspaces' stacks can never collide.
- **`ServiceStack` model** stores the SANITIZED compose + service names + status; the Conductor is the only
  writer (`service-provision`/`service-teardown`, `workspaceSettings`-gated). The docker calls take an injectable
  runner (unit/integration-tested without a daemon).

## Rejected alternatives

- **A fixed catalog-provisioner (only Postgres/Redis/… we hard-code).** Rejected: the user explicitly wants ANY
  tool; a compose-engine + presets covers both. (K2 adds the presets as the easy path.)
- **Run the raw compose unchanged.** Rejected: a compose can take over the host (docker.sock / privileged /
  host-mounts) and collide on host ports across tenants — the sanitizer + namespacing are non-negotiable.
- **A full compose-spec parser (js-yaml).** Rejected: no `@types/js-yaml` (a boot-crash-risk transitive per the
  CI parser's own note); the existing dep-free `parseYamlSubset` handles the structure, and a raw-scan backstops
  flow-style — fail-closed either way.

## Consequences

- The sanitizer + engine (naming/args/network-inject) + the persist path are pure/injectable + unit +
  integration-tested (`composeSanitize` 31, `composeEngine` 9, `serviceStack` 12). The real `docker compose up`
  is Docker (user-triggered).
- Provision runs on the Conductor chain; a long `up` (image pull) blocks that workspace's writer — a follow-up
  can fire the docker step async (like `provisionContainers`). Violation detail is logged server-side; a rich
  in-UI violations panel + a `serviceStacks` snapshot field + K2 presets are follow-ups. K3 injects the service
  connection env into the agent/preview containers; K4 fixes the integration MCP scripts.
