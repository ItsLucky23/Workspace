---
name: audit-required-production-dependencies-and-test-tooling-separately
title: Audit required production dependencies and test tooling separately
status: accepted
date: 2026-07-27
deciders: [mathijs]
tags: [security, dependencies, ci, eslint, release]
supersedes: [0039]
relates: [0038]
---

## Context

The first v0.8.0 provenance workflow failed on Linux lint before publication. A global override had forced minimatch 10.2.5 and brace-expansion 5.0.8 across the whole tree to silence the brace-expansion advisory. Older ESLint plugins such as `eslint-plugin-jsx-a11y` intentionally depend on the callable CommonJS API from minimatch 3; forcing the ESM-oriented minimatch 10 contract made `label-has-associated-control` crash on Linux even though the Windows lint run passed.

Removing those incompatible overrides restores each consumer's supported minimatch major. npm still includes this ESLint-only tree in `npm audit --omit=dev` because `@luckystack/core` exposes ESLint as an optional peer, causing the root's development ESLint install to be marked `devOptional` rather than purely `dev`. The affected expansion call is not present in LuckyStack's runtime dependency graph and the configured lint rules do not accept attacker-controlled brace patterns.

## Decision

The production release gate runs `npm audit --omit=dev --omit=optional --json`. This audits required runtime dependencies and excludes optional peer/tooling trees. It retains the exact React Router RSC/action advisory allowlist described by ADR 0039; every other high or critical finding still fails closed.

Tooling is guarded separately rather than made runtime-audit-shaped through incompatible overrides:

- Linux CI must build packages and run root + package lint before publication.
- The lockfile keeps each lint plugin on its declared minimatch major instead of globally replacing dependency contracts.
- The brace-expansion finding remains explicitly tracked as non-runtime and is re-evaluated when the ESLint plugins adopt a compatible patched minimatch line.

The moderate Hono path remains non-blocking under the established high+ policy and is unreachable because `@luckystack/mcp` is stdio-only. The exact React Router exception remains necessary because LuckyStack does not enable RSC/action transport.

## Rejected alternatives

- **Force minimatch 10 and brace-expansion 5 globally.** Passes the audit report but violates old plugin contracts and crashes Linux lint.
- **Treat optional lint peers as production runtime dependencies.** Misclassifies local/CI tooling and encourages unsafe dependency overrides.
- **Remove the ESLint peer declaration from core only to change npm's lockfile flags.** Hides the real `@luckystack/core/eslint` consumer contract instead of expressing the audit scope correctly.
- **Skip tooling security review.** The advisory remains in the findings ledger and Linux lint remains mandatory; exclusion from the runtime audit is not deletion from review.

## Consequences

- Required runtime dependencies remain covered by a fail-closed high/critical release gate.
- Optional tooling vulnerabilities are assessed by reachability and validated on Linux, rather than silently admitted or forced through incompatible majors.
- Release audits must continue to review both the runtime report and tracked tooling findings.
- ADR 0039 is superseded because its global brace-expansion remediation did not preserve cross-platform lint compatibility.
