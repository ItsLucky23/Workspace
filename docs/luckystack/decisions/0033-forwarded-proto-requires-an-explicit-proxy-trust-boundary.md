---
name: forwarded-proto-requires-an-explicit-proxy-trust-boundary
title: Forwarded HTTPS is trusted only from configured immediate proxy CIDRs
status: accepted
date: 2026-07-21
deciders: [mathijs]
tags: [router, security, proxy, tls, headers]
supersedes: []
relates: [0016]
---

## Context

The LuckyStack router listens on plain HTTP and commonly sits behind a TLS
terminator. It previously preserved an inbound literal `x-forwarded-proto:
https` after stripping the original header. A directly connected client could
therefore make backend secure-cookie/redirect logic believe a plaintext request
was HTTPS. Ignoring the header unconditionally would be safe but would break the
documented nginx/ALB/Cloud Run topology.

## Decision

`deploy.config.ts > routing.trustedProxyCidrs` is the explicit trust boundary.
The default is empty: no peer may assert HTTPS. HTTP and WebSocket paths compile
the configured addresses/subnets once with Node's `BlockList`, inspect only the
immediate socket peer, and emit `https` only when that peer is trusted and the
header's first value is exactly `https`. Malformed entries abort router boot.
Forwarded chains remain discarded.

## Rejected alternatives

- **Trust every literal `https` value.** This is the original direct-client
  spoofing bug.
- **Trust every private/loopback address automatically.** Private networks are
  not automatically trusted; another workload in the VPC could spoof the
  scheme. Operators must name the actual ingress subnet.
- **Ignore forwarded proto in every deployment.** Secure by default, but it
  makes a normal external TLS terminator invisible and breaks correct backend
  URL/cookie behavior.

## Consequences

- Direct router users require no configuration and always forward `http`.
- Same-host nginx/Caddy can trust `127.0.0.1/32` and `::1/128`; managed ingress
  uses its documented private subnet(s).
- Moving load balancers or changing ingress ranges requires a config update.
- `0.0.0.0/0` and `::/0` are technically expressible but explicitly documented
  as unsafe because they recreate the original trust-any-client behavior.
