---
id: 0305
title: Release lockfile is generated with the production npm version
status: accepted
date: 2026-07-28
tags: [dependencies, deployment, npm, arm64, reproducibility]
supersedes: []
---

# 0305 — release lockfile is generated with the production npm version

## Context

After the safe PostCSS/MCP updates, npm 11.6.1 on Windows produced and accepted a lockfile that omitted several
platform-optional transitive package records. Production runs npm 10.9.8 on ARM64. Its clean installer rejected
that same lockfile as inconsistent (`@csstools/css-parser-algorithms`, `@csstools/css-tokenizer`, `@emnapi/*`
missing), so a locally green install was not release-reproducible.

## Decision

- Declare `packageManager: npm@10.9.8`, matching the production host.
- Generate dependency lock changes with npm 10.9.8 and require `npm ci --dry-run` to pass under that version before
  deployment.
- Keep every platform's optional package records in the committed lockfile; do not hand-prune them on Windows.
- Production continues to install from the committed lockfile with `npm ci`.

## Rejected alternatives

- **Use npm 11 locally and `npm install` in production:** rejected because production would silently rewrite the
  release graph instead of proving the committed graph.
- **Hand-add only the four errors reported by ARM64:** rejected because optional native packages form a larger,
  platform-dependent set and manual lockfile surgery is incomplete and unauditable.
- **Upgrade the Pi's global npm ad hoc:** rejected because that changes host tooling merely to accommodate a
  non-portable lockfile and does not prevent the next developer from recreating it.

## Consequences

- Lockfile diffs can include optional packages for platforms other than the author's machine; that is intentional.
- Dependency updates should use the declared npm version (for example `npx npm@10.9.8 install`).
- Windows and ARM64 clean installs now validate the same dependency graph before release.
