---
id: 0306
title: LuckyStack upgrades jump straight to the newest patch of a minor
status: accepted
date: 2026-08-05
tags: [dependencies, luckystack, upgrade, transport, security]
supersedes: []
---

# 0306 — LuckyStack upgrades jump straight to the newest patch of a minor

## Context

The app ran `@luckystack/*` 0.7.6 (published 2026-07-23); npm `latest` was 0.8.3 (2026-07-28). The four intervening
releases landed inside 20 hours, which is a signal rather than a detail:

- `0.8.0` was published broken and re-tagged (`v0.8.0+publish.1`).
- `0.8.1` was a security patch 31 minutes later (ADR 0040 upstream): with `NODE_ENV=production` plus a non-production
  `LUCKYSTACK_ENV`, 0.8.0 skipped generated production maps, loaded devkit into source-free images, weakened
  secure-cookie and bootstrap policy, and could activate loopback rate-limit bypasses.
- `0.8.2` fixed composed atomic presets returning 500 on every API/sync request.
- `0.8.3` made routed HTTP honor the generated API method map instead of inferring the method from the route name.

Upstream ships no migration guide for 0.8, so the breaking surface had to be derived from the tag diff (17 commits,
169 files) before committing to the jump.

## Decision

- Upgrade all 16 `@luckystack/*` packages to 0.8.3 **in lockstep**, in one step. Their internal peer ranges are
  `^0.8.3`; a partial bump is unsupported.
- Do **not** step through 0.8.0 → 0.8.1 → 0.8.2. Each intermediate is a known-defective state and stopping on one
  would mean verifying a version nobody should run.
- Pin `transport: { invocation: 'socket' }` explicitly in `config.ts` even though it equals the framework default,
  because the alternative (`routed-http`) drops the offline queue's retry path.
- Wire the generated `apiMethodMap` through `registerApiMethodMap` in `src/_sockets/apiRequest.ts`, so a future
  transport switch cannot silently fall back to inferring HTTP methods from route names.

## Rejected alternatives

- **Stay on 0.7.6:** rejected because the gap only widens, and 0.7.6 predates the upstream runtime-mode security
  separation. The cost of a deferred upgrade grows with every minor.
- **Step through each 0.8.x release, verifying at each:** rejected because three of the four intermediates are
  defective by their own author's account; a green run on 0.8.0 would prove nothing worth knowing.
- **Adopt `routed-http` while upgrading:** rejected as unrelated scope with a known gap (no offline retry), and it
  would require declaring `customRoutes` ownership for all 11 custom route prefixes.
- **Take upstream's `resolveEnvKey` change as a required migration:** rejected because it does not apply here —
  `NODE_ENV=production` is already set explicitly beside `LUCKYSTACK_ENV` in the systemd unit, Dockerfile,
  compose file and deploy env example. Nothing to migrate; the invariant was verified, not changed.

## Consequences

- Every `@luckystack/*` bump from now on is an all-16 operation; a single-package bump is a bug.
- `config.ts` now states its transport rather than inheriting it, so `luckystack add router` cannot flip invocation
  mode as a side effect — that becomes a visible edit here.
- Two upstream sharp edges are inherited and deliberately not worked around: production runtime maps load lazily on
  the first request (so `/readyz` reports green before a malformed map surfaces — readiness proves infrastructure,
  not route resolution), and `routed-http` has no offline retry.
- The 7 open `npm audit` findings are unchanged by this upgrade. The install added zero packages and altered zero
  non-LuckyStack versions; the counts moved because the advisory database moved, not the dependency tree.
