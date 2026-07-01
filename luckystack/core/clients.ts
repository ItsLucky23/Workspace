//? Prisma + Redis client overrides. Leave empty to use the framework's
//? lazy defaults (PrismaClient + ioredis from .env). Override here if you
//? need a custom logger, Accelerate, sentinel/cluster Redis, TLS, etc.
//?
//? Examples:
//?
//?   import { registerPrismaClient } from '@luckystack/core';
//?   import { PrismaClient } from '@prisma/client';
//?   registerPrismaClient(new PrismaClient({ log: ['warn', 'error'] }));
//?
//?   import { registerRedisClient } from '@luckystack/core';
//?   import Redis from 'ioredis';
//?   registerRedisClient(new Redis({ host: '...', tls: {} }));

export {};
