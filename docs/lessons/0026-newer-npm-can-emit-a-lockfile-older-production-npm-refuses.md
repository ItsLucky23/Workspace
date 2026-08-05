---
id: 0026
title: A newer npm can emit a lockfile that production npm refuses
severity: high
area: dependencies, deployment, arm64
date: 2026-07-28
---

# 0026 — validate lockfiles with the production package manager

## What happened

A dependency update installed, audited, built and passed `npm ci --dry-run` under npm 11 on Windows. The same
committed `package-lock.json` failed immediately under npm 10.9.8 on the ARM64 production host because optional
transitive records were absent.

## Root cause

The npm versions normalize optional/peer dependency metadata differently. A platform-local successful install did
not prove that an older npm on another architecture could reconstruct the graph.

## How to avoid

- Pin the project's package manager version and use it to regenerate the lockfile.
- The `packageManager` field is advisory: npm does not enforce it without Corepack, so a bare `npm install` under a
  newer npm silently rewrites the lockfile anyway. Invoke the pinned version explicitly —
  `npx npm@10.9.8 install` — and verify the canary optional records (`@csstools/*`, `@emnapi/*`) survived.
- Run `npm ci --dry-run` with the production npm version before copying a release.
- Treat cross-platform optional-package additions in the lockfile as required reproducibility metadata, not noise.
- Never work around an inconsistent lockfile with production-side `npm install`; fix and recommit the lockfile.
