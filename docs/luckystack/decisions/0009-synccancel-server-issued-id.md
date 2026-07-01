---
name: synccancel-server-issued-id
title: Key syncCancel on a server-issued cancel id, not the client-controlled callback name
status: accepted
date: 2026-06-15
deciders: [ItsLucky23]
tags: [sync, security, correctness]
supersedes: []
relates: []
---

## Context

The sync abort registry keyed in-flight requests on the `${name}/${version}` callback identity the client supplied. Two concurrent requests to the same route shared that key, so the second `register` clobbered the first's `AbortController` and a cancel aborted/deleted the wrong request — a correctness bug reachable by an ordinary client, and the key was client-controlled.

## Decision

The server mints a unique `randomUUID()` `cancelId` per sync request, registers the `AbortController` under `${socket.id}:${cancelId}`, and hands the id to the client via a `{ __cancelId }` handshake frame on the existing progress channel. The client echoes it back as `syncCancel { cb: <cancelId> }`. The wire field stays `cb` (so the server-side cancel listener in `@luckystack/server` is unchanged — only the *value* is now a server-issued opaque id), which kept the change inside the `@luckystack/sync` package.

## Rejected alternatives

- **Key on the client-supplied `responseIndex`** — rejected: still client-controlled and collidable by a duplicate/malicious client.
- **Add a new `cancelId` wire field + edit core's cancelRegistry / server's loadSocket listener** — rejected: out of the sync package's ownership and unnecessary — reusing the `cb` field with a server-issued value achieves the same correctness with zero cross-package change.

## Consequences

Concurrent same-route requests now cancel independently. The cancel id is unforgeable and non-reusable. No wire-field rename, so no cross-package edit. A syncCancel correctness test pins the behaviour.
