---
name: oauth-port-hop-preserves-explicit-local-ingress
title: OAuth port hopping preserves an explicitly configured local ingress
status: accepted
date: 2026-07-21
deciders: [ItsLucky23]
tags: [core, server, oauth, ports, router]
supersedes: []
relates: [0016]
---

## Context

Development auto-increment can move a direct backend from its intended port to the
next free port. OAuth authorize and token exchange must then use the same live
`redirect_uri`, or the provider callback reaches the stale process. v0.7.3 solved
that by rewriting every localhost callback to the bound service port.

But `oauthCallbackBase` is also the configured external backend ingress. In local
multi-instance or reverse-proxy development, `http://localhost:4000` may
intentionally be the router while a service binds `:4100`. Unconditionally replacing
`:4000` with `:4100` silently bypasses that explicit ingress and removes failover or
routing behavior.

## Decision

Core retains two bind values:

1. the intended pre-listen address from `registerBindAddress`;
2. the successful address reported by `node:http` via `registerBoundAddress`.

`resolveDevCallbackUrl` rewrites a loopback callback (`localhost`, `127.0.0.1`, or
`[::1]`) only when its effective port still equals the intended pre-listen port and
the bound port differs. A callback on any other port is treated as an explicit
local ingress and remains unchanged. Production and non-loopback callbacks remain
no-ops.

OAuth authorize and token exchange both call the same resolver, preserving the
provider's byte-identical `redirect_uri` requirement.

## Rejected alternatives

- **Always replace a localhost callback with the bound service port** — convenient
  for direct backends, but silently bypasses an explicitly configured router or
  reverse proxy.
- **Never rewrite OAuth callbacks** — preserves explicit ingress but leaves the
  default direct-development flow broken after an auto-increment hop.
- **Derive the callback from the request `Host` header** — makes a security-critical
  provider redirect request-influenced and can disagree between authorize and
  token exchange.
- **Add a router-specific environment check in core** — couples core OAuth behavior
  to one ingress implementation and still misses other local reverse proxies.

## Consequences

- Default direct development follows the actually-bound backend port after a hop.
- Explicit localhost router/reverse-proxy callback bases remain authoritative.
- Core exposes `registerBoundAddress`; server bootstrap owns calling it after a
  successful listen.
- Programmatic `options.port` callers whose callback intentionally points elsewhere
  must configure that callback explicitly; core will not infer that every local
  mismatch is stale.
- Provider consoles still need every direct auto-incremented callback URI registered,
  because the framework cannot alter provider-side allowlists.
