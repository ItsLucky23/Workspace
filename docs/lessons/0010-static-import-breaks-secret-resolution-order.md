---
id: 0010
title: A static import at server.ts top can build the default Prisma client before secrets resolve
severity: high
area: server/boot, secret-manager, prisma
date: 2026-07-03
---

# 0010 — Static imports vs secret-resolution order at boot

## What happened

Adding `import { startTicketWatchdog } from './orchestrator/watchdog'` at the top of `server.ts`
made every default-Prisma-client query in a background loop fail at runtime with:

```
Error validating datasource `db`: the URL must start with the protocol `mongo`.
```

The app itself (API/sync routes) kept working, which made it look like a bug in the new code — it
wasn't. The integration tests (which resolve secrets via `db()` first) all passed.

## Root cause

`server.ts` resolves secret-manager pointers (`DATABASE_URL = BASE_V<n>` → a real `mongodb://` URL)
by `await initSecretManager(...)` INSIDE the async boot IIFE. The default Prisma client is built the
first time `getPrismaClient()` runs, and it reads `DATABASE_URL` at construction.

The Conductor does `const prisma = getPrismaClient()` at MODULE level. A **static** import of any
module that (transitively) imports the Conductor runs that line during `server.ts`'s import phase —
which is BEFORE the IIFE body calls `initSecretManager`. So the default client captures the raw,
unresolved pointer and every query through it fails. Tenant clients (built later, post-resolution)
are unaffected, which is why the UI still worked and the failure looked isolated to the new loop.

## How to avoid

- Background-loop starters whose module graph reaches the Conductor (or any module-level
  `getPrismaClient()`) must be **dynamically imported** in `server.ts` AFTER `initSecretManager`:
  `const { startTicketWatchdog } = await import('./orchestrator/watchdog'); startTicketWatchdog();`
  — this is the same pattern the error-tracking adapters already use.
- Symptom → cause: "URL must start with mongo" from ONLY the background loops (not the routes) ⇒ a
  default client was constructed pre-secret-resolution ⇒ find the new static import that pulled the
  Conductor into the boot graph and make it dynamic.
- Related Mongo gotcha found the same day: `prisma.findMany({ where: { field: null } })` does NOT
  match documents where the optional field is unset — filter such fields in code, not the query.
