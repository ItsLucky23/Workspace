---
name: narrow-reachability-aware-production-audit-exception
title: Use a narrow reachability-aware production audit exception
status: superseded
date: 2026-07-27
deciders: [mathijs]
tags: [security, dependencies, ci, react-router, release]
supersedes: []
relates: [0038]
---

## Context

The v0.8.0 audit fixed reachable PostCSS and brace-expansion advisories and upgraded React Router to current 7.18.1. npm still reports one high React Router advisory (`GHSA-qwww-vcr4-c8h2`) affecting RSC/action request handling. LuckyStack uses browser routing and does not enable React Router RSC or action transport.

There is no safe React Router 7 release that makes npm's current advisory database fully green: 7.18.1 contains fixes for numerous browser/SSR advisories but is flagged for the RSC-only issue; npm's suggested 7.11.0 downgrade removes that report while reintroducing a larger set of high XSS, redirect, RCE, CSRF and DoS reports. React Router 8.3 is outside `react-router-dom` 7's supported dependency contract.

## Decision

Keep current React Router 7.18.1 and replace the release workflow's raw `npm audit --audit-level=high` command with `npm run audit:production`.

The custom gate parses npm's production audit JSON and accepts only the exact `GHSA-qwww-vcr4-c8h2` advisory on `react-router` plus its `react-router-dom` propagation. Any additional advisory, changed package, high/critical dependency, or malformed audit output fails closed. The exception remains documented in the dated dependency findings ledger and must be re-evaluated each release.

The moderate `@hono/node-server` advisory remains non-blocking under the existing high+ release policy. `@luckystack/mcp` is stdio-only and never exposes Hono's affected Windows `serve-static` middleware.

## Rejected alternatives

- **Downgrade React Router to 7.11.0.** Clears the newest RSC report but reintroduces many high advisories affecting browser/SSR surfaces LuckyStack actually uses.
- **Force React Router 8.3 under react-router-dom 7.** Violates the package's exact dependency contract and risks untested runtime breakage.
- **Lower the global audit threshold to critical.** Would silently admit every future high advisory instead of only the reviewed, unreachable one.
- **Ignore npm audit entirely.** Removes a useful release regression gate.

## Consequences

- CI stays blocked on every unreviewed high/critical production advisory.
- The exact allowlist is temporary and should be removed when a compatible patched React Router release exists.
- Release notes must disclose the accepted advisory and its non-reachability rationale.
