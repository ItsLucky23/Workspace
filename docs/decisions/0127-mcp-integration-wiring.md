---
title: The user's MCP integration command is mounted into the container .mcp.json (X1)
status: accepted
date: 2026-07-07
tags: [extensibility, mcp, containers, freedom-program]
---

## Context

FREEDOM_PROGRAM item **X1**. `renderStage` built the container `.mcp.json` from skill keys ONLY — a workspace's
own `IntegrationTool.mcp.command` was stored but inert (never mounted), so an enabled integration did nothing
for the agent.

## Decision

- `renderStage` now also emits one stdio MCP server per **enabled** integration tool: a pure
  `parseMcpCommand(cmd)` splits the command string into `{ command, args }`, `mcpKey(name)` sanitizes the
  server key, and the tool's credentials are injected as `env`. `stageRunner.loadMcpIntegrations` resolves each
  `IntegrationField.envVarId` to its EnvVar (decrypted) and passes the tools into the (still-pure) renderer.
  Skills + integrations coexist in one `.mcp.json`.

## Rejected alternatives

- **Keep credentials out of env.** An MCP server reads its auth from env; injecting the referenced EnvVars is
  what makes the integration usable. They stay server-side (inside the container), never in the transcript.
- **Do ro/rw tier enforcement now.** `McpCfg` is `{ enabled, command }` — there is no tier field to enforce
  yet; adding the tier model + `.mcp.json` scoping is a follow-up (called out here), not silently skipped.
- **Free-text integration type in the UI now.** The model already permits a `custom` type; only the settings
  dropdown restricts it — a thin UI follow-up, separate from the load-bearing mount wiring.

## Consequences

- An enabled integration tool actually mounts an MCP server the agent can call, credentials injected — verified
  by a fixture asserting the generated `.mcp.json` (`stageEngine` 27/27). The ro/rw tier field + enforcement and
  the free-text-type UI dropdown are documented follow-ups on top of this.
