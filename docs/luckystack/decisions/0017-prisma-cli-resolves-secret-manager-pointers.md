---
name: prisma-cli-resolves-secret-manager-pointers
title: Prisma (and other) CLI commands resolve secret-manager pointers via an always-on wrapper, not a full server boot
status: accepted
date: 2026-07-01
deciders: [mathijs]
tags: [secret-manager, prisma, cli, scaffold, dx, packaging]
supersedes: []
relates: [0016]
---

## Context

With `@luckystack/secret-manager`, secrets are **rotation-aware pointers** in
`.env` (`DATABASE_URL=DB_CONNECTION_STRING_V3`) that only become real values at
boot, when `resolveSecretsIfConfigured` / `initSecretManager` writes them into
`process.env`. `prisma/schema.prisma` reads `url = env("DATABASE_URL")`.

The scaffold's `prisma:*` scripts ran `dotenv -e .env.local -- prisma …`, which
loads the raw `.env.local` values and shells straight into Prisma. That never
runs the secret-resolution step, so with secret-manager enabled Prisma receives
the raw pointer string (`DB_CONNECTION_STRING_V3`) instead of a connection
string and `db push` / `migrate` fail. Reported by the user.

## Decision

Route every `prisma:*` script through a small wrapper, `scripts/prismaWithSecrets.ts`,
that runs the boot **prefix** — `loadEnvFiles()` (`.env` + `.env.local`), then,
if a secret-manager URL is configured, resolve pointers into `process.env` — and
then `spawnSync('prisma', argv)` inheriting the resolved env. It does NOT start
the HTTP/socket server: Prisma only needs the env and opens its own DB
connection, so there are no ports to bind or connections to tear down.

The wrapper is **always-on** (the `prisma:*` scripts always call it, in every
scaffold), but its secret-resolution block ships **commented out** — byte-identical
to the enable-later block in `server/server.ts`. `luckystack add secret-manager`
(and a `--secret-manager` scaffold) uncomment it with the same find/replace they
already apply to `server/server.ts`; `remove` re-comments it. Without
secret-manager the wrapper is just `loadEnvFiles()` + prisma — a superset of the
old `dotenv -e .env.local`.

## Rejected alternatives

- **Start the full server to resolve secrets, then run prisma.** Heavier and more
  fragile: it binds ports and opens Redis/socket connections that must then be
  torn down, for zero benefit — Prisma needs only `process.env`.
- **Inject the wrapper (and rewrite the 3 `prisma:*` scripts) only when
  secret-manager is opted in.** Keeps the base scaffold on the familiar `dotenv`
  form, but adds a fourth place where `add` / `remove` / scaffolder must stay
  byte-identical — exactly the add↔scaffolder parity-drift class that is this
  project's #1 defect source. Always-on with a commented block needs no script
  rewrite: the scripts are set once and only ONE extra find/replace target is
  added to the existing secret-manager toggle (guarded by `assetParity.test.ts`).
- **Statically `import '@luckystack/secret-manager'` in an always-shipped
  wrapper.** Breaks the base-scaffold typecheck when the optional package is not
  installed (`TS2307`). The comment/uncomment convention (mirroring
  `server/server.ts`) is the established, typecheck-safe pattern for referencing
  an optional package from shipped template code.

## Consequences

- New scaffolds: `prisma:*` "just works" whether or not secret-manager is added;
  adding secret-manager needs no manual script change.
- `dotenv-cli` (the `dotenv -e` provider) is no longer used by any script and
  becomes an orphaned devDep in the template + root reference app — flagged for
  the user to drop or keep (a consumer may still want it for ad-hoc commands).
- The wrapper files carry `//? @adr 0017` so a future reader doesn't "simplify"
  the indirection away without seeing why it exists.
- Any other CLI tool needing resolved secrets (a one-off migration, a backfill)
  should copy the same shape: `loadEnvFiles()` → resolve → do the work.
