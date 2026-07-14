---
name: orm-choice-with-none-via-registration-hook
title: Scaffold gets an ORM dimension (prisma/drizzle/none); 'none' is a registration hook with a clear runtime error, not a full prune
status: accepted
date: 2026-07-08
deciders: [ItsLucky23]
tags: [scaffold, cli, database, orm, dx]
supersedes: []
relates: [0014, 0017]
---

## Context

The scaffold wizard hardwires Prisma: an unguarded static `import { PrismaClient }` in `packages/core/src/db.ts:2` (boot crashes if the package is missing), a Prisma ping baked into `/readyz` (`packages/server/src/httpRoutes/healthRoutes.ts`), and template files (`functions/db.ts`, `prisma/schema.prisma`, `prisma:*` scripts, `luckystack/core/clients.ts` registration). The `dbProvider` wizard dimension is substitution-only — no ORM abstraction exists. Meanwhile the framework's own persistent-DB surface is small: only the `User` entity, already behind a swappable `UserAdapter`; sessions, rate-limiting, one-time tokens and OAuth state are all Redis. Users want to choose their ORM (or bring their own data layer) at scaffold time, and change it later via the manage CLI.

## Decision

Add an `orm` dimension to the scaffold wizard and manage CLI: first round `prisma` / `drizzle` / `none` (MikroORM is the follow-up candidate because it covers MongoDB first-class). `orm: 'none'` is **hook-based, not prune-everything**: the scaffold ships the existing `luckystack/core/clients.ts` extension-point file as a stub ("register your own database client / UserAdapter here"); any DB access without a registration throws a clear LuckyStack error that names that exact file; a hard boot-time error fires only when an enabled feature demonstrably requires the DB (e.g. login with the default Prisma UserAdapter). The `/readyz` DB ping becomes pluggable so a DB-less project can report ready. The wizard filters DB options by ORM choice (e.g. Drizzle hides MongoDB).

## Rejected alternatives

- **Full per-ORM prune for 'none'** (strip every DB trace from the template) — rejected: large brittle template surface, and a missing-registration situation would surface as vague module/runtime errors instead of one actionable message pointing at the hook file.
- **Always hard boot error when no DB is registered** — rejected: a deliberately DB-less project is legitimate (sessions and rate-limiting run on Redis, not the ORM); the error must be lazy unless a feature actually needs the DB.
- **Convex (backend-as-a-service) as an alternative "ORM" option** — rejected: category mismatch; Convex brings its own reactive sync engine that competes with LuckyStack's socket-first sync layer rather than plugging into it.
- **Keep Prisma mandatory (status quo)** — rejected: the coupling is small enough (3 runtime sites) that forcing Prisma on every consumer is unjustified.

## Consequences

- `packages/core/src/db.ts` needs a guarded/lazy Prisma import; `/readyz` needs a `registerDbHealthCheck`-style seam.
- Per-ORM template/asset variants fall under the assetParity byte-lockstep guard — variants must exist in `template/` and stay byte-synced.
- Making ORM reconfigurable in the manage CLI requires persisted scaffold state — provided by the scaffold manifest ([0021]); ADR 0014's inference model deliberately skips migration-bearing axes like this one.
- Wizard must block invalid combos (mongodb + drizzle) by filtering DB options on ORM choice.
- The 'none' path ships a documented checklist (custom UserAdapter if login stays on, hand-written SessionLayout, strip prisma scripts, repoint `functions/db.ts`).
