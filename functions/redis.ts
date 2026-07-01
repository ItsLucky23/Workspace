//? Framework-default shim. Re-exports the ioredis singleton from @luckystack/core
//? so it shows up as `functions.redis.redis` (and `functions.redis.default`) inside
//? every API + sync handler.
//?
//? Edit this file to wrap Redis usage (custom key-prefix per tenant, dead-letter
//? queue patterns, retry policies). Affects calls that go through
//? `functions.redis.redis` in your own handlers. Framework-internal code
//? (sessions, rate-limiting, presence) imports the redis singleton directly
//? from `@luckystack/core` and is NOT affected.
//?
//? For a framework-WIDE override (so framework internals use it too), the native
//? hook is `registerRedisClient(client)` from '@luckystack/core' — call it at boot
//? in the editable `luckystack/core/clients.ts` overlay (it ships with ready examples).
//? Re-export via module-specifier (`export … from`) so the codegen can
//? resolve the real type at compile time. The locally-bound
//? `import { redis }; export { redis }` form falls back to `any` because
//? the resolver can't trace the underlying module from a named export
//? alone.
export { redis, redis as default } from '@luckystack/core';
