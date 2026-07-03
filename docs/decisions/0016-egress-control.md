---
name: egress-control
title: Egress control on worker containers — an internal network + an allowlist forward proxy
status: accepted
date: 2026-07-03
deciders: [ItsLucky23]
tags: [security, containers, egress, multi-tenant, market]
supersedes: []
relates: [0008]
---

## Context

A worker container runs code the AI writes plus a repo's dependencies — not fully trusted, and a
single malicious npm/pip package can exfiltrate. Until now workers ran on the default bridge with
FULL outbound network: they could POST secrets (env, the projected `~/.claude` creds, tokens) or the
repo's code to any host, reach internal services, or abuse the host (mining/spam). That is the top
blocker to letting customers trust their private code to the platform.

## Decision

Opt-in egress control (`WS_EGRESS=1`, default OFF ⇒ current behaviour unchanged). New
`server/container/egress.ts`; `launchTicketContainer` calls `ensureEgressInfra()` and adds
`egressLaunchArgs()` when enabled:

- **Isolation** — the worker joins `ws-egress`, an `--internal` docker network with NO route out.
- **Allowlist proxy** — a squid container sits on BOTH `ws-egress` and a normal network, so it (and
  only it) bridges outward; the worker's `HTTP(S)_PROXY` points at it. squid ACLs allow CONNECT/GET
  only to a domain allowlist (npm/yarn/pip/crates, GitHub/GitLab/googlesource, OS repos, the AI APIs),
  extendable via `WS_EGRESS_ALLOW`; everything else is denied. Domain-level, no MITM.

Verified against real Docker (`scripts/spike/egressSpike.mts`): an allowlisted domain (github.com)
returns 200 through the proxy, a non-allowlisted one (example.com) is blocked, and a direct request
with no proxy has no route at all (isolation).

## Rejected alternatives

- **iptables/nftables IP allowlist.** Rejected: registry/CDN IPs are dynamic and fronted by CDNs;
  a domain allowlist (a forward proxy) is the correct granularity.
- **No egress control / trust the container hardening.** Rejected: `--cap-drop ALL` +
  `no-new-privileges` stop privilege escalation but do NOTHING against plain outbound HTTP
  exfiltration — a different threat that needs a network control.
- **Always-on.** Rejected for now: it changes the network topology (inbound preview/editor traffic
  must be reconciled with the internal network) and would disturb the current working single-host
  setup. Opt-in ships the capability without forcing the topology before it's needed.

## Consequences

- With `WS_EGRESS=1`, a compromised dependency or the AI itself cannot reach an arbitrary host —
  only the allowlist. This is the security precondition for multi-tenant/customer code.
- **Inbound coexistence**: the per-ticket editor/preview subdomains need Caddy/nginx → container
  reachability. Combined with egress, put the reverse proxy on `ws-egress` too (documented in
  egress.ts + docs/WORKSPACES_MULTI_INSTANCE.md). Single-host dev without egress is unaffected.
- The squid proxy is one shared container per host (idle when unused). Its config is regenerated from
  the allowlist on each `ensureEgressInfra`; `access_log none` (the image's `proxy` user can't write
  /dev/stdout).
- A too-tight allowlist surfaces as a build/install failure inside the container — extend
  `WS_EGRESS_ALLOW` rather than disabling egress.
