---
name: upgrade-deps
description: Semver-aware dep updater that bumps patch/minor in a single safe pass and proposes majors individually.
category: tooling
---

# Skill: /upgrade-deps

Smart semver-aware dependency updater. Runs `npm outdated --json`, groups by major / minor / patch, bumps patch+minor in one pass (running lint+build+test between bumps), and surfaces majors as individual per-package proposals with changelog snippets.

## When to use

- Periodic maintenance (monthly).
- After a `/security-audit` flagged advisories that need fresh upstream versions.
- Before a release, to land deps cleanly without surprises.

## Workflow

### 1. Snapshot current state

```bash
npm outdated --json > .outdated.json
git status   # confirm working tree is clean — abort if not.
```

If working tree has changes, tell the user: "Working tree is not clean. Commit or stash before running /upgrade-deps so a bad bump can be reverted." Stop.

### 2. Categorize

Parse `.outdated.json`. For each entry compute:

- `current` → `wanted`: patch+minor — safe.
- `current` → `latest`: includes a major bump — surface separately.

Build two queues:

- `safeQueue`: patch + minor bumps.
- `majorQueue`: each major bump as its own proposal.

### 3. Apply the safe queue

For each package in `safeQueue` (alphabetical, stable order):

```bash
npm i <pkg>@<wanted-version>
npm run lint
npm run build
npm test
```

If any of lint/build/test fails:

1. `git restore package.json package-lock.json node_modules` (or `npm i` back to the previous version).
2. Note the failure with: package, old version, new version, the failing command's tail (last 30 lines).
3. Stop the safe queue and report.

If all three pass:

1. Commit: `chore(deps): bump <pkg> from <old> to <new>`.
2. Move to the next package.

### 4. Handle the major queue

For each major:

- Read the package's changelog from `node_modules/<pkg>/CHANGELOG.md` if present, or fetch the GitHub releases page via `gh api repos/<owner>/<repo>/releases` if `gh` is available.
- Extract the entries between `current.major` and `latest.major`.
- Pull out lines marked `BREAKING`, `breaking`, or under a `### Breaking` heading.
- Output a proposal block:

```
Major bump available: react-router  6.20.0 → 7.0.0
Breaking changes:
  - Removed deprecated <Route element> prop.
  - File-based route loader signature changed.
  - Minimum Node version raised to 18.

Recommended approach:
  1. Read the migration guide: <url>.
  2. Branch off, do the bump in isolation, fix call sites, then merge.

Do NOT bundle this with the safe-queue bumps.
```

Do NOT apply majors automatically — the user must explicitly request each one.

### 5. Report

```
[upgrade-deps] <YYYY-MM-DD>

Safe queue (patch + minor):
  Applied (8):
    typescript 5.7.0 → 5.7.3
    vite 5.4.0 → 5.4.10
    ... 
  Failed (1):
    @prisma/client 6.5.0 → 6.5.4 — npm test failed on src/db/prismaClient.tests.ts.
    Reverted. Investigate before re-running.

Skipped (lockfile clean): 14 packages were already at wanted.

Major queue (3):
  react-router 6 → 7 — BREAKING (see proposal below).
  zod 3 → 4 — BREAKING (see proposal below).
  ...
```

## Verification

- Each safe-queue commit independently passes lint+build+test.
- The major queue produces no automatic changes.
- After running, `npm outdated` shows only majors + the one failed safe bump.

## Notes / Limitations

- Skill requires `npm` (yarn / pnpm not supported in this version).
- Skill assumes the project has `npm test` configured; if not, it falls back to `npm run lint && npm run build`.
- Major-bump changelog parsing is best-effort. Some packages do not maintain `CHANGELOG.md`.
- Does NOT cross-check `package.json` peer-dependency constraints — if a minor bump violates a peer, it will still be applied and the failure will surface in lint/build.
- Does NOT publish, push, or create PRs — the user controls the merge step.
