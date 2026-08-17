---
name: scaffold-port-default-stays-out-of-process-env
title: Keep the scaffold backend default out of process.env until server bootstrap
status: superseded
date: 2026-08-16
deciders: [mathijs]
tags: [config, ports, scaffold, oauth, server]
supersedes: []
superseded_by: [0045]
relates: [0016, 0031]
---

## Context

The scaffold owns its single-instance backend default in the pure-data
`config.ports.ts` file and passes that value to `@luckystack/server` as
`defaultPort`. `@luckystack/core` also validates `SERVER_PORT` with a legacy
fallback of `80` and previously copied that implicit fallback into
`process.env`. The consumer `config.ts` then observed `80` before server
bootstrap applied `defaultPort`, so OAuth provider registration could target a
different port from the backend that actually listened.

## Decision

`@luckystack/core` keeps `SERVER_PORT='80'` in its validated environment
snapshot and keeps the generic server fallback, but does **not** write the
implicit value into `process.env`. `process.env.SERVER_PORT` remains reserved
for an explicitly supplied environment value or the positional CLI-port
writeback from `@luckystack/server/parseArgv`.

The scaffold continues to derive its dev OAuth callback base from
`process.env.SERVER_PORT ?? ports.backend`. The server continues to resolve
ports as `options.port > argv > defaultPort > explicit SERVER_PORT > 80`.
After binding, the existing core intended/bound registry and
`resolveDevCallbackUrl` handle auto-increment hops. No framework package
imports a consumer `config.ports.ts`, and router remains optional.

## Rejected alternatives

- **Ignore `SERVER_PORT=80` only in scaffold config.ts** — duplicates framework
  default detection in every consumer and cannot distinguish an explicit user
  choice of port 80 from the implicit fallback.
- **Make `config.ports.ts` a core/router dependency** — violates the consumer
  ownership boundary and would make the optional router part of the base path.
- **Remove the legacy `SERVER_PORT` fallback entirely** — breaks generic
  consumers that do not pass `defaultPort`; the fallback remains available
  below the scaffold contract.

## Consequences

- A scaffold with `ports.backend=4787` binds and advertises `4787`, and its
  OAuth callback base is also `http://localhost:4787` without `SERVER_PORT`.
- An explicit CLI port remains visible to consumer config and wins at listen
  time.
- Auto-increment still rewrites the authorize and token-exchange
  `redirect_uri` identically to the actually-bound port.
- Generic consumers without `config.ports.ts` remain supported through their
  explicit `oauthCallbackBase` or the existing `app.publicUrl` fallback.
- Code that relied on an implicit `process.env.SERVER_PORT === '80'` must use
  the validated core snapshot or the server's documented fallback instead.
