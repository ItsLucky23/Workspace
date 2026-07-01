---
name: tenantdb-no-arg-findmany-leak
title: tenantDb's $extends must inject workspaceId even when the query has no `where` (no-arg findMany leaked cross-tenant)
severity: critical
area: server/tenant
date: 2026-07-01
tags: [multi-tenancy, security, prisma, tests]
relates: [workspaces-v1-schema-shape]
---

# 0003 — tenantDb no-arg `findMany()` leaked every workspace's rows

> A real cross-tenant data leak, caught by the `tests/integration/tenant.test.mts`
> isolation test — the single most valuable thing that test suite found.

## What happened

`server/tenant/tenantDb.ts`'s Prisma `$extends` where-injection only added
`workspaceId` inside an `else if ('where' in a)` branch. So a query WITH a `where`
was scoped, but a **no-arg read** — `tenantDb.workspaceRole.findMany()` — had no
`where` key, skipped the injection, and returned **every workspace's rows**. The
canonical read path, `server/read/workspaceSnapshot.ts`, uses exactly the no-arg form
for tickets/members/stages/roles/… — so with more than one workspace in the DB it
would have served one tenant another tenant's data.

It stayed hidden because every manual E2E test ran with a single workspace, where
"all rows" and "this workspace's rows" are identical.

## Root cause

The isolation extension keyed on the PRESENCE of `where` rather than the OPERATION.
Reads/updates/deletes must always be `where`-scoped; a missing `where` is the most
dangerous case (it means "all rows"), not a case to skip.

## How to avoid

- **For every non-create tenant operation, force `where.workspaceId` — create the
  `where` if none exists.** Only `create`/`createMany` inject into `data`; `upsert`
  needs BOTH (`where` + `create`). The fix:
  ```ts
  if (operation === 'create') { a.data = { ...data, workspaceId }; return query(args); }
  if (operation === 'createMany') { /* map rows + workspaceId */ return query(args); }
  const where = a.where;
  a.where = where && typeof where === 'object' ? { ...where, workspaceId } : { workspaceId };
  if (operation === 'upsert') a.create = { ...a.create, workspaceId };
  ```
- **Always test tenant isolation with ≥2 workspaces and a NO-ARG read.** A single-tenant
  test can never catch a scoping leak. `tests/integration/tenant.test.mts` now asserts a
  bare `findMany()` inside `runInTenant(wsA)` returns only wsA's rows.
- General: prefer verifying an isolation *guarantee* over the happy path — the happy
  path passed for months here while the guarantee was broken.
