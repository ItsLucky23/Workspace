/// <reference types="node" />

//? Operator restore entrypoint (DR_RUNBOOK): `npm run db:restore -- <backup-file> --yes`.
//? DESTRUCTIVE — drops + re-inserts every collection present in the backup, so it hard-requires the
//? explicit --yes flag. Resolves the secret-manager pointers first (same dance as testWithSecrets.ts)
//? so Prisma connects with real credentials. Restoring data does NOT restore WORKSPACES_ENC_KEY —
//? the same key that wrote the encrypted secrets must be present or they stay unreadable.

import { loadEnvFiles } from '@luckystack/core';

const run = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const yes = args.includes('--yes');
  if (!file) { console.error('usage: npm run db:restore -- <backup-file.ndjson.gz> --yes'); process.exit(1); }
  if (!yes) { console.error('refusing to restore without --yes (this DROPS every collection in the backup first)'); process.exit(1); }

  loadEnvFiles();
  const projectConfig = (await import('../config')).default;
  if (projectConfig.secretManager?.url) {
    const sm = await import('@luckystack/secret-manager');
    await sm.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  }
  const { getPrismaClient } = await import('@luckystack/core');
  const { restoreBackup } = await import('../server/db/backup');
  const res = await restoreBackup(getPrismaClient(), file);
  if (!res.ok) { console.error(`restore FAILED: ${res.error ?? 'unknown'}`); process.exit(1); }
  console.log(`restored ${String(res.docs)} documents across ${String(res.collections)} collections from ${file}`);
  process.exit(0);
};

void run();
