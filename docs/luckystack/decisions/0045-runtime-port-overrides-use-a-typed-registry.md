---
name: runtime-port-overrides-use-a-typed-registry
title: Runtime backend-port overrides use a typed core registry, never process.env
status: accepted
date: 2026-08-16
deciders: [mathijs]
tags: [config, ports, scaffold, oauth, server, cli]
supersedes: [0044]
relates: [0031, 0043]
---

## Context

ADR 0043 made consumer-owned `config.ports.ts` the static source of truth, but
ADR 0044 retained `SERVER_PORT` as an argv-to-config bridge and generic server
fallback. That left one backend-port value in four different contracts: the
consumer default, positional argv, the process environment, and the
intended/bound runtime registry.

Removing the environment bridge must preserve positional overrides, dev
port auto-increment, byte-identical OAuth authorize/token-exchange callbacks,
programmatic `createLuckyStackServer({ port })`, optional router ingress, and
generic consumers that do not own `config.ports.ts`.

## Decision

`SERVER_PORT` is removed from the core environment schema, server precedence,
bind-address fallback, CLI diagnostics, and scaffold/runtime config.

The port contract is:

```text
options.port > positional argv registry override > options.defaultPort > 80
```

`@luckystack/server/parseArgv` registers a numeric positional port through
`registerPortOverride(port)` in the dependency-free `@luckystack/core/config`
entry. Consumer `config.ts` reads `getPortOverride() ?? ports.backend`; the
server reads the same registry through `getParsedPort()`. No environment value
is written.

`createLuckyStackServer` registers both its effective intended port and optional
`defaultPort` metadata before request-time OAuth provider construction. The
OAuth callback resolver may rewrite a loopback callback that names either the
intended port or that consumer default. A different explicit local callback
port remains a router/reverse-proxy ingress and is not bypassed. After listen,
the node-reported bound port remains authoritative for auto-increment and Vite
proxy advertisement.

`SERVER_PORT_AUTO_INCREMENT` remains a separate policy flag.

## Rejected alternatives

- **Keep the environment fallback for generic consumers** — rejected because it
  preserves two runtime channels and lets dotenv/import ordering influence the
  listen contract. Generic consumers can pass `port`/`defaultPort`; an entirely
  unspecified server still receives numeric fallback 80.
- **Import consumer `config.ports.ts` from a framework package** — rejected
  because the file is consumer-owned and the router remains optional.
- **Always rewrite any localhost OAuth callback to `options.port`** — rejected
  because it would silently bypass an explicit local router/reverse proxy,
  violating ADR 0031.
- **Store `options.port` in the CLI override registry** — rejected because a
  programmatic option is server-factory state and consumer config may already
  have evaluated. Intended/default bind metadata solves request-time OAuth
  parity without misrepresenting the source as argv.

## Consequences

- Migrate a legacy environment port by editing `config.ports.ts`, passing
  `port`/`defaultPort`, or using `node dist/server.js <preset> <port>`.
- Positional CLI ports are visible to both consumer config and server bootstrap
  through one typed, browser-safe registry.
- Programmatic ports, default ports, auto-incremented bound ports, and OAuth
  callbacks stay aligned without request host inference.
- Existing code that reads `env.SERVER_PORT` or sets `SERVER_PORT` must migrate;
  this is an intentional compatibility break in the pre-1.0 API.
