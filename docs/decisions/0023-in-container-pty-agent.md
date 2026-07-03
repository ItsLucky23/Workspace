---
id: 0023
title: In-container pty-agent — durable scrollback + crash-resume for container terminals
status: accepted
date: 2026-07-03
tags: [workspaces, containers, terminal, pty, crash-resume]
supersedes: []
---

# 0023 — In-container pty-agent (07b §9)

## Context

Goal-item #11. Container terminals were a HOST `docker exec -it <c> bash` PTY (the seam in
`server/hooks/workspacesTerminal.ts`). That PTY dies with the backend process and holds its
scrollback only in host memory, so an orchestrator crash / restart loses the whole terminal +
history — contradicting the "ring-buffer reseeds the browser view on reconnect" resume promise
(07b §9, `Q-CT-PTYAGENT`/`Q-CT-RESUME`).

## Decision

A small **pty-agent process runs INSIDE each L3 container** and owns the shell PTY + a **durable
scrollback**; the orchestrator RELAYS it over the unchanged `ws-term:*` protocol, so the xterm
client stays byte-identical.

- **`docker/pty-agent/agent.mjs`** (baked into L1): spawns a shell via the pre-installed global
  node-pty (resolved via `NODE_PATH`), keeps a byte-bounded scrollback ring PERSISTED to a file on
  the `/work` volume, and serves a line-delimited-JSON TCP protocol. On each client connect it
  REPLAYS the scrollback then streams live; multiple clients share the one PTY; a dead shell is
  respawned. On its own startup it RELOADS the scrollback file — so history survives a container
  `--restart` (and, because the agent is a container process, an orchestrator crash).
- **`server/container/ptyAgentClient.ts`** (host relay): `connectPtyAgent(host, port, handlers)`
  translates the agent frames to the `onData`/`onExit` the `ws-term:*` bridge already speaks;
  `resolvePtyAgentPort` reads the host port the container published (`docker inspect`).
- **`launchTicketContainer`** publishes the agent port to the host loopback (`-p 127.0.0.1::7681`);
  the L1 CMD starts the agent in the background alongside the `sleep infinity` keepalive (so
  `docker exec` for claude turns is unchanged).
- **`workspacesTerminal.ts`** prefers the agent for a container terminal (durable), and FALLS BACK
  to a `docker exec` PTY when no agent port is published (a container built before the agent) or the
  relay errors — so the change is safe on pre-existing containers.

The orchestrator's ring-buffer becomes a cache rebuilt by replay; the agent is the source of truth
for scrollback. The claude-turn PTY stays on `docker exec` (its crash-resume is ADR 0022's
`--resume`); unifying claude-driving under the agent is a later slice.

## Rejected alternatives

- **Keep the in-memory host ring (`ManagedSession`).** Cannot survive a crash — the whole point.
- **A new WS protocol / verb for the agent.** `ws-term:*` is a transport, not a structured-channel
  verb; reusing it keeps the xterm client byte-identical and adds no verb (invariant 2).
- **Persist scrollback host-side.** The container owns its own lifetime + volume; a
  container-resident buffer survives a container `--restart` too, which a host buffer can't
  attribute correctly across re-association.
- **Make the agent the container CMD outright.** Would couple container liveness to the shell PTY;
  running it beside `sleep infinity` keeps `docker exec` (claude turns) unchanged.

## Consequences

- Container terminals survive an orchestrator restart + reseed on reconnect with full scrollback.
- **Activation needs an L1 rebuild** (developer action): `docker build -f docker/base.Dockerfile
  -t workspaces/base:0.1.0 .` (context = repo root, so the `COPY docker/pty-agent/agent.mjs`
  resolves). Until then, container terminals use the (unchanged) `docker exec` fallback.
- Verified: `ptyAgent.test.mts` (6/6) runs the REAL agent as a local process through the REAL host
  relay (no Docker) — live streaming, input, scrollback REPLAY on reconnect, and survival across an
  agent restart (reloaded from the volume file = crash-resume). Full suite 25/25, clean backend boot.
