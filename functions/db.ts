//? Framework-default shim. Re-exports the Prisma singleton from @luckystack/core
//? so it shows up as `functions.db.prisma` inside every API + sync handler.
//?
//? Edit this file to wrap or tweak Prisma client behavior (logging, soft-delete
//? extensions, multi-tenant routing). Your edits affect calls that route through
//? `functions.db.prisma` — typically your own handlers via the injected `functions`
//? parameter. Framework-internal code (`@luckystack/login`, `@luckystack/sync`, etc.)
//? imports the prisma singleton directly from `@luckystack/core` and is NOT affected.
//?
//? For a framework-WIDE override (so framework internals use it too), the native
//? hook is `registerPrismaClient(client)` from '@luckystack/core' — call it at
//? boot in the editable `luckystack/core/clients.ts` overlay (it ships with ready
//? examples). Use Prisma's `$extends` there for behavior tweaks on that client.
export { prisma } from '@luckystack/core';
