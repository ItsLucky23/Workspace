---
name: mikro-orm-cli-figlet-crash-node22-windows
title: The @mikro-orm/cli crashes on Node 22 / Windows — run the SchemaGenerator via the API
severity: high
area: packages/create-luckystack-app (mikro-orm scaffold)
date: 2026-07-12
tags: [scaffold, mikro-orm, cli, windows, secret-manager]
---

# 0004 — The @mikro-orm/cli crashes on Node 22 / Windows — run the SchemaGenerator via the API

## What happened

A mikro-orm scaffold wired `db:schema:update` to `mikro-orm schema:update --run`
(the `@mikro-orm/cli`). On Node 22 / Windows the CLI crashes before doing any
work — its `figlet` banner dependency blows up. Surfaced by a consumer AI on a
real project, not by our tests (we shipped the CLI-based script and never ran
it end-to-end on Node 22 / Windows). Separately, even when the CLI *does* run it
reads `DATABASE_URL` raw, so a `@luckystack/secret-manager` pointer
(`NAME=BASE_V<n>`) is never resolved — the CLI has no seam to resolve it.

## Root cause

Depending on a third-party CLI for a one-line operation couples us to that
CLI's transitive deps (here `figlet`) and its env handling (no secret-manager
resolution). The equivalent operation is a two-line MikroORM API call.

## How to avoid

- Prefer the ORM's programmatic API over its CLI for framework-shipped scripts.
  `db:schema:update` now runs `orm.getSchemaGenerator().updateSchema()` in
  `scripts/mikroOrmSchema.ts` (via `tsx`), the exact equivalent of
  `schema:update --run`, with `loadEnvFiles()` + guarded secret-manager
  resolution first (mirrors `scripts/prismaWithSecrets.ts`). No `@mikro-orm/cli`
  dependency, no `figlet`, works on Node 22 / Windows, and honors
  secret-manager-resolved `DATABASE_URL`.
- When a scaffold ships a runnable script for a specific Node/OS combo, RUN it
  on that combo before shipping — a `--no-install` scaffold + tsc never exercises
  the actual command. (Same class as lesson 0001 / the runtime-test-before-ship
  memory.)
