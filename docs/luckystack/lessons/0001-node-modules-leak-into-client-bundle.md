---
name: node-modules-leak-into-client-bundle
title: A node:* server import in shared/client code blanks the whole frontend
severity: critical
area: packages/core (client/server boundary)
date: 2026-06-23
tags: [runtime, bundling, client-server-boundary]
---

# 0001 — A node:* server import in shared/client code blanks the whole frontend

## What happened

A change pulled a server-only module (transitively importing `node:async_hooks`) into a
path that the client bundle reaches. Type-checking passed, the build "succeeded", and
1200+ unit tests were green — but the real frontend rendered a blank page in the browser.
Static audits and the test suite all missed it; only loading the app caught it.

## Root cause

The core client/server boundary is leaky: an import that looks shared can drag a Node
built-in into the browser bundle, which throws at module-eval time and kills render
before any error boundary mounts. A source-only static gate does not fully model "does this end up in the client
bundle". It also missed a later recurrence where the source graph used a lazy dynamic
import correctly, but tsup coalesced that dynamic target and a client-used logger into
one shared emitted chunk containing `node:async_hooks`.

## How to avoid

Never import a `node:*` module (or anything that transitively does — `async_hooks`,
`fs`, `child_process`) from code the client bundle can reach; use the
`@luckystack/core/client` entry. Keep server-only state such as AsyncLocalStorage in a
separate module rather than relying on a lazy import inside a mixed registry.

Most importantly, inspect the **emitted chunk graph**, not only source imports: the core
build now walks every static/dynamic relative chunk reachable from `dist/client.js` and
fails on any Node builtin. And ALWAYS smoke-test the real browser before calling a
change "ship-safe" — a green compile alone does not prove the page renders. Related:
`docs/examples/trycatch-error-handling.md`.
