/// <reference types="node" />

//? Runs the test suite with the project's env FULLY resolved — mirrors scripts/prismaWithSecrets.ts (@adr 0017).
//? The batch runner (testAll.ts) connects to Redis/Mongo via env values that in this project are
//? @luckystack/secret-manager POINTERS (`NAME=BASE_V<n>`, e.g. REDIS_PASSWORD=REDIS_PASSWORD_V1). Core boot's
//? dotenvx re-injects those raw pointers, and the test-runner opens a Redis connection before the async
//? secret-manager resolution wins the race → `WRONGPASS` on the literal pointer. Here we resolve the pointers
//? into process.env FIRST (after core's dotenvx, so the resolved values are the final state), THEN dynamically
//? import testAll so the runner connects with real credentials. Without a configured secret-manager URL this is
//? just loadEnvFiles() + the tests (a superset of the old behaviour). In-process (not spawned) so the resolved
//? env persists past core's override.

import { loadEnvFiles } from '@luckystack/core';

const run = async (): Promise<void> => {
  loadEnvFiles();
  const projectConfig = (await import('../config')).default;
  if (projectConfig.secretManager?.url) {
    const sm = await import('@luckystack/secret-manager');
    await sm.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  }
  await import('./testAll.ts');
};

void run();
