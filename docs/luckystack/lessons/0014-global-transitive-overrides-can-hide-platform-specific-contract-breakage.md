---
name: global-transitive-overrides-can-hide-platform-specific-contract-breakage
title: Global transitive overrides can hide platform-specific contract breakage
severity: high
area: dependencies
date: 2026-07-27
tags: [dependencies, eslint, linux, ci, release]
---

# 0014 — Global transitive overrides can hide platform-specific contract breakage

## What happened

A global brace-expansion override broke lint locally, so a second global minimatch 10 override was added. Windows root and package lint then passed, but the first v0.8.0 GitHub provenance workflow failed before publication. A clean Node 22 Linux reproduction showed `eslint-plugin-jsx-a11y` crashing because it expected minimatch 3's callable CommonJS export while the override supplied minimatch 10.

## Root cause

A transitive security override changed a dependency's major-version API contract for every consumer. The compensating override fixed the first observed platform but did not make older plugins compatible. Windows module interop masked the mismatch; Linux exposed it. The original audit report also mixed required runtime dependencies with a `devOptional` ESLint tree introduced by core's optional ESLint peer.

## How to avoid

- Never silence a transitive advisory by globally forcing an incompatible major without testing every consumer contract.
- Reproduce release gates in the target Linux/Node environment before tagging, not only on the developer OS.
- Distinguish required runtime dependencies from optional peer/tooling trees in audit policy, while tracking both explicitly.
- Keep the lockfile on each package's declared compatible major and prefer upstream plugin upgrades over cross-major overrides.
- Treat a green audit report as insufficient when the dependency graph no longer matches consumers' declared ranges.

## Related

- `docs/decisions/0041-audit-required-production-dependencies-and-test-tooling-separately.md`
- `docs/findings/2026-07-27-v080-dependency-audit/README.md`
- `.github/workflows/publish.yml`
