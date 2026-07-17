---
name: windows-lockfile-can-omit-linux-optional-transitives
title: A Windows-green lockfile can be invalid for Linux npm ci
severity: high
area: release
date: 2026-07-16
tags: [npm, lockfile, ci, cross-platform, release]
---

# 0011 — A Windows-green lockfile can be invalid for Linux npm ci

## What happened

The fully tested v0.7.0 release was tagged, but both the regular Linux CI matrix and
GitHub's publish workflow failed immediately in `npm ci`. npm reported that
`@emnapi/core@1.11.2` and `@emnapi/runtime@1.11.2` were missing from the lockfile.
Nothing had reached npm yet.

Local Windows `npm install`, `npm audit`, builds, Verdaccio publication, `npm pack`, and
`npm publish --dry-run` were all green. Even regenerating the lock with
`--package-lock-only --os=linux --cpu=x64` did not materialize the two entries. They are
transitives of optional WASM/native fallback packages; npm's platform pruning omitted
them while Linux npm still validated that dependency edge during `npm ci`.

## Root cause

A package-lock generated and validated on one OS is not proof that `npm ci` can consume
it on another OS when optional platform packages are involved. `npm install` reused a
Windows-pruned optional tree, and `pack`/`publish --dry-run` do not perform a clean Linux
install, so every local release gate missed the invalid cross-platform closure.

## How to avoid

- Validate release lockfiles with the npm majors used by CI: `npm ci --dry-run
  --ignore-scripts` under npm 10, 11, and the publish workflow's current npm.
- Keep `@emnapi/core` and `@emnapi/runtime` as root dev dependencies while the
  transitive optional-dependency graph needs them. Direct dependencies force npm to
  retain their lock entries on Windows; they are tooling-only and are not published in
  any LuckyStack package tarball.
- A successful `npm install` is not equivalent to `npm ci`; the latter validates the
  committed graph before installing.
- Do not move or recreate a release tag until the CI install step has passed. If a tag
  has already fired but publication has not started, fix `main` and use the manual
  publish workflow from the corrected commit rather than force-moving the tag.

## Related

- `docs/findings/2026-07-16-v070-ci-publish-readiness/README.md`
- GitHub publish run `29507130350` (failed safely before build/publish)
