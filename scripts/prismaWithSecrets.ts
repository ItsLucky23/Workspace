/// <reference types="node" />

//? @adr 0017 — this wrapper (and its always-on shape) is a deliberate decision;
//? read docs/decisions/0017 before "simplifying" the indirection away.
//? Runs a Prisma CLI command with the project's env FULLY resolved — including
//? @luckystack/secret-manager pointers. `prisma db push` / `migrate` read
//? `url = env("DATABASE_URL")` from schema.prisma; when DATABASE_URL is a
//? secret-manager pointer (`NAME=BASE_V<n>`) the raw pointer string is useless to
//? Prisma, so we resolve it into process.env HERE — the same resolve
//? server/server.ts does — before spawning prisma. Without a configured
//? secret-manager URL this is just `loadEnvFiles()` (`.env` + `.env.local`)
//? followed by prisma, i.e. a superset of the old `dotenv -e .env.local`.
//?
//? NB: imports @luckystack/secret-manager directly (a node_modules package)
//? rather than `../server/bootstrap/initSecrets` — this file lives in scripts/,
//? which no tsconfig `include` covers, so the editor checks it in an inferred
//? project where a cross-project relative import (../server/**) fails to resolve
//? (ts2307) while a package import always resolves. Mirrors the template wrapper.

import { spawnSync } from 'node:child_process';
import { loadEnvFiles } from '@luckystack/core';

const run = async (): Promise<void> => {
  loadEnvFiles();
  const projectConfig = (await import('../config')).default;
  if (projectConfig.secretManager?.url) {
    const sm = await import('@luckystack/secret-manager');
    await sm.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  }

  const result = spawnSync('prisma', process.argv.slice(2), {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
  if (result.error) console.error(result.error);
  process.exit(result.status ?? 1);
};

void run();
