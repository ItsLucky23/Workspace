---
name: status-line-is-not-a-handshake
title: A green test that asserts the status line proved the router could proxy WebSockets — it never could
severity: critical
area: packages/router
date: 2026-07-15
tags: [testing, sockets, router, protocol, false-green]
---

# 0008 — A status line is not a handshake

## What happened

`@luckystack/router`'s WebSocket proxy could not complete a single WebSocket handshake
for **three weeks** (0.4.0 → 0.6.7, shipped to npm), while its unit suite was fully
green the entire time.

A 2026-06-19 security sweep began filtering the upstream `101 Switching Protocols`
response before writing it to the client, so a backend could not inject `Set-Cookie`
or internal `x-luckystack-*` markers into the browser's header context. Sound goal.
It filtered with `WS_HOP_BY_HOP_HEADERS` — the **request**-direction hop-by-hop set,
which contains `connection`.

`Connection` is hop-by-hop by RFC 7230 in general. On a 101 it is the header that
*makes the response an upgrade* (RFC 6455 §4.2.2 requires `Upgrade: websocket` **and**
`Connection: Upgrade`). Stripping it left:

```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Sec-WebSocket-Accept: ...
```

Node's HTTP parser will not emit `'upgrade'` for that, and socket.io/ws reject it with
an opaque `websocket error`. Every WebSocket through the router died — the package's
entire reason to exist in a multi-instance deploy.

The test that was supposed to catch this:

```ts
const statusLine = await sendUpgrade(h.port, '/socket.io/?EIO=4');
expect(statusLine).toContain('101');
```

It passed. It kept passing. **The status line was never wrong** — the helper read up to
the first CRLF and stopped, so the assertion could not see the headers where the whole
protocol lives.

Underneath it sat a second, independent bug: the HTTP proxy resolved socket.io's polling
handshake (`/socket.io/?EIO=4&transport=polling`) by first path segment, looked for a
service named `socket.io`, and returned `502`. Since the framework's client sets no
`transports`, every browser starts with that poll — so even a *fixed* 101 would never
have been reached. Two bugs, same path, both invisible to the suite.

## Root cause

The tests asserted the **cheapest observable**, not the **contract**. "Did a 101 come
back" is easy to assert and nearly free of meaning; "can a client complete a handshake"
is the actual claim and requires a client.

The findings ledger had flagged the gap in plain language — *"Boot + listen proven; a WS
upgrade THROUGH the proxy has not been load-tested"* — and that row was correct and
ignored, because everything around it was green. Green is a very effective anaesthetic.

Both bugs were found within minutes of pointing a real `socket.io-client` at the router,
and pinned down by diffing raw bytes direct-to-backend vs through-the-proxy — a diff
that made the missing header impossible to argue with.

## How to avoid

- **When you implement a protocol, test the protocol, not a substring of it.** For an
  upgrade that means: a real client connects, and the negotiated transport is
  `websocket`. Anything less tests your own mock.
- **A test helper that stops reading early caps what any assertion built on it can ever
  catch.** `sendUpgrade` returned the first line; no test using it could have found
  this, no matter how well written. Audit helpers for what they *discard*.
- **Treat "not covered" rows in a ledger as red, not as prose.** The gap was written
  down and stayed open because nothing was failing.
- **Directional rules need directional sets.** Hop-by-hop, forwarded headers, CORS —
  request-side and response-side rules are different rules. Reusing one set for both is
  a recognisable smell; name the sets after the direction
  (`WS_RESPONSE_HOP_BY_HOP_HEADERS`) so the wrong one looks wrong at the call site.
- **When a security fix filters something, pin what it must NOT filter in the same
  commit.** The sweep's intent was right; only its blast radius was wrong, and a single
  test asserting `connection: upgrade` survives would have caught it on day one.

## Related

- `docs/findings/2026-07-15-bun-feasibility/README.md` — B17 (the 101), B18 (the poll),
  B7 (the row that named the gap)
- `packages/router/src/proxyUtils.ts` — `WS_RESPONSE_HOP_BY_HOP_HEADERS`
- [[find-the-real-failure-before-fixing]] · [[a-fix-that-never-fires-verify-the-trigger]]
  — same family: verify the thing you believe, don't verify a proxy for it
