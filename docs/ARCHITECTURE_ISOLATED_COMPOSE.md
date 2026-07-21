# Isolated unrestricted Docker Compose

<!-- @covers server/container/{composeEngine,isolatedComposeRunner}.ts -->

## Contract

Workspace users may submit unrestricted Docker Compose, including third-party images, bind mounts, external
networks, `privileged`, devices and Docker-socket mounts. Such a file is equivalent to root access to the Docker
host on which it runs. **It must never run on the Workspaces application Docker daemon.** Sanitizing YAML is not
a security boundary for unrestricted Compose.

Production enables Compose only through:

```env
WS_COMPOSE_RUNNER_URL_TEMPLATE=https://compose-runner.example/workspaces/{workspaceId}/
# secret, in .env.local / deploy/.env
WS_COMPOSE_RUNNER_TOKEN=...
```

Requirements:

- HTTPS only; URL credentials, query strings and fragments are refused.
- `{workspaceId}` is mandatory and must resolve to a **dedicated VM/microVM/physical sandbox per workspace**.
  A shared Docker daemon with project-name prefixes is not tenant isolation.
- Taking over that workspace sandbox is allowed. Reaching the Workspaces app host, another workspace sandbox,
  host metadata or operator networks is not.
- The runner authenticates the bearer token, independently verifies the workspace identity in the URL/body,
  applies CPU/RAM/disk/time quotas, and returns bounded JSON.
- If app/agent containers need a service, the runner returns explicit gateway/overlay environment values in
  `env`. Workspaces never invents service-name DNS across two different Docker daemons.
- The operator owns sandbox provisioning, patching, snapshot/reset, network policy and garbage collection.

## Runner HTTP API

For a template ending in `/workspaces/{workspaceId}/`, Workspaces calls:

- `POST v1/compose/up` with `{ workspaceId, project, compose }`
- `POST v1/compose/down` with `{ workspaceId, project }`

Response (maximum 64 KiB):

```json
{
  "ok": true,
  "services": ["db", "queue"],
  "env": {
    "DATABASE_URL": "postgres://workspace-gateway/db"
  }
}
```

The submitted Compose body is capped at 1 MiB. Workspaces stores a system execution marker plus the raw YAML,
so teardown always returns to the same backend. The Conductor remains the authoritative database writer.

## Development fallback

When no isolated runner is configured and `NODE_ENV != production`, the old local mode remains available for
fast development. It rejects host binds, privileged/capability/device/host-namespace directives and rewrites
published ports. This fallback is intentionally **not** “free Compose”. In production, missing runner config
fails closed with `service.isolatedRunnerRequired` and never touches `/var/run/docker.sock`.

## Verification boundary

Unit/integration tests prove URL separation, TLS/token handling, raw Compose preservation, explicit gateway env,
persistence markers and teardown routing. A release still needs a live infrastructure test against the chosen
VM/microVM runner to prove host escape, cross-workspace isolation, quotas, DNS/gateway connectivity and cleanup.
