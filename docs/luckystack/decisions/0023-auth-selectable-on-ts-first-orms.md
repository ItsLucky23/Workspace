---
status: accepted
date: 2026-07-11
tags: [scaffold, auth, orm, cli]
supersedes-partially: [0020]
---

# Auth is selectable on drizzle/mikro-orm scaffolds (starter UserAdapter); only orm 'none' forces auth off

## Context

ADR 0020 introduced the ORM choice and, as a consequence, forced `auth: 'none'`
for EVERY non-prisma ORM ("the built-in UserAdapter is Prisma-backed"). In
practice this dropped the whole auth step from the scaffold wizard the moment a
user picked mikro-orm/drizzle — surfaced by the user as a gap ("auth is uit de
wizard flow"). Meanwhile the ORM-aware CLI work (feat/orm-aware-cli) had already
produced commented-complete per-ORM starter UserAdapters for the manage/add
paths, making the blanket restriction obsolete.

## Decision

- The scaffold wizard shows the auth step for **prisma, drizzle and mikro-orm**;
  only `orm: 'none'` forces auth off (there is no data layer to write an
  adapter against). Explicit `--orm=none --auth=<mode>` exits 2 (mirrors the
  drizzle+mongodb hard reject).
- A non-prisma auth scaffold keeps the adapter-based flows
  (login/register/reset-password, LoginForm, functions/session.ts,
  @luckystack/login) and writes the per-ORM starter
  `luckystack/login/userAdapter.ts` (auto-imported at boot via the login
  overlay slot; consumer finishes 2 documented steps).
- The **Prisma-bound surface is pruned** to keep the scaffold buildable on
  first try: `src/settings` (6 `_api` routes call `functions.db.prisma`
  directly) and `server/hooks/notifications.ts` (`getPrismaClient()`; would
  fail silently inside its tryCatch on every login). README/Home.tsx/next-steps
  text is adjusted accordingly.
- `luckystack add login` behaves identically on a non-prisma project: it no
  longer copies the Prisma-bound files (previously it copied them and warned
  "port these" — leaving a project that could not compile).
- The starter strings are duplicated in create-luckystack-app and
  @luckystack/cli (they cannot import each other at runtime) and pinned
  byte-identical by a parity test.

## Rejected alternatives

- **Keep the skip, message it better** — still leaves the #1 wizard dimension
  invisible for TS-first ORM users; the starter-adapter machinery already
  existed, so the cost of doing it properly was low.
- **Ship the settings routes + notifications on non-prisma anyway (warn only)**
  — violates "buildable on first try" (tsc fails on `functions.db.prisma`) or,
  for notifications, ships a silently-dead feature.
- **Port the settings routes to the UserAdapter now** — requires a login
  interface decision (UserRecord lacks `theme`/preferences patch typing);
  deliberately parked as its own follow-up round.

## Consequences

- Wizard review shows auth again for drizzle/mikro-orm; sign-in works only
  after the consumer finishes the starter adapter (clearly warned in the
  next-steps block).
- Non-prisma auth scaffolds have no account-settings page until the
  Prisma-bound routes are ported (parked follow-up; see ADR 0020 notes).
- `switchOrm` (manage) now names concretely which existing Prisma-bound auth
  files will stop compiling when switching away from prisma.
