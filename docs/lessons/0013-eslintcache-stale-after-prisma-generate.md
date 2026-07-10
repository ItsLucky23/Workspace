---
id: 0013
title: .eslintcache holds stale type-aware results after prisma generate — phantom "error typed" lint on a new field
severity: medium
area: prisma, schema-change, eslint, dev-tooling
date: 2026-07-10
---

# 0013 — stale `.eslintcache` after a schema change → phantom lint errors on a new Prisma field

## What happened

Added a new field (`captionMode`) to a Prisma model, ran `npm run prisma:generate` + `prisma:db:push`,
then `npm run typecheck` — **clean**. But `npm run lint` reported 3 errors on the lines that read the new
field:

```
@typescript-eslint/no-unsafe-assignment  Unsafe assignment of an error typed value
@typescript-eslint/no-unsafe-argument    Unsafe argument of type error typed ...
```

i.e. eslint's type-aware rules saw `piece.captionMode` as an **error type** (property-doesn't-exist), while
`tsc` — reading the freshly-regenerated `@prisma/client` — saw it as `string`. The two disagreed, which is
the tell.

## Root cause

The `lint` script runs eslint with `--cache --cache-location .eslintcache`. The cache had been written on a
prior run whose type-aware results were computed against the **pre-regen** Prisma client (where the field
did not exist). A content-hash change to the edited file re-lints *that file*, but the cached type graph for
`@prisma/client` was reused, so the new field still resolved to an error type. `tsc` has no such cache →
it was correct; eslint was stale.

## How to avoid

- After a `prisma generate` / schema change, if lint reports `error typed` / `no-unsafe-*` on a **new**
  model field while `tsc` is clean, it's the eslint cache — `rm -f .eslintcache` and re-run `npm run lint`.
- The signal is the **tsc-clean vs eslint-error disagreement on a Prisma field** — don't start casting or
  re-typing the code to satisfy eslint; the code is fine, the cache is stale.
- Related Windows/prisma pitfall on the generate step itself: [[0012-prisma-generate-eperm-locked-engine-dll]].
