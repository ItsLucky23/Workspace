---
name: devtools-lag-measurement-pitfalls
title: Measuring DevTools-open lag — three pitfalls that produce wrong conclusions
severity: medium
area: performance diagnostics (scripts/devtoolsLagHarness)
date: 2026-07-03
tags: [performance, devtools, react, measurement, cdp]
---

# 0003 — Measuring DevTools-open lag: three pitfalls that produce wrong conclusions

## What happened

While quantifying the React 19 `console.createTask` DevTools-lag (branch
`debug/devtools-lag`), three separate measurement mistakes each produced a
confidently-wrong intermediate conclusion:

1. A 5s **pointermove storm** over `/playground` showed 60fps in every cell — "no
   effect measurable". But dispatched pointer events trigger almost **no React
   re-renders**, and `createTask` fires per JSX element per render. No renders →
   no createTask load → the storm measured nothing.
2. An **oversaturated stress cell** (n=4000 tiles @ 30Hz, 16k DOM nodes, 9fps
   baseline) returned *inverted* numbers (instrumentation ON measured faster than
   OFF) because JIT/layout warm-up noise dwarfed the effect being measured.
3. Filtering network requests on `xhr,fetch` (and later reading
   `performance.getEntriesByType('resource')`) showed only `transport=polling`
   socket.io requests → "socket never upgrades to websocket". False: **websocket
   connections appear in neither list**. The socket had upgraded fine
   (`socket.io.engine.transport.name === 'websocket'`).

## Root cause

The lag mechanism is *per-render* (createTask per JSX element) and *per-async-hop*
(V8 debugger async tracking), so a valid benchmark must (a) drive real re-renders,
(b) sit in a load regime where the page still has headroom, and (c) inspect
runtime state directly instead of inferring from side channels.

## How to avoid

Use `scripts/devtoolsLagHarness/cdpStressTest.mjs` with the committed
`/devtools-lag-test` page at a NON-saturated point (n=1500, hz=20 → ~27fps
baseline is the validated regime). Drive re-renders (setState on an interval),
not synthetic pointer events. For socket-transport questions, read
`socket.io.engine.transport.name` from the live module — never conclude from the
request list. And remember `Debugger.setAsyncCallStackDepth` only approximates an
open DevTools; console-object retention and source-map parsing exist only in the
real DevTools frontend, so the final verdict needs a manual check.
