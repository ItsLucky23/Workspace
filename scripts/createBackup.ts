/// <reference types="node" />

//? Operator-grade pre-migration backup. Resolves the same secret-manager pointers as production,
//? writes a complete Mongo dump plus file-backed media/repos, and records checksums + the encryption-key
//? fingerprint in one manifest. The key itself is deliberately never copied into the backup.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getPrismaClient, loadEnvFiles, tryCatch } from '@luckystack/core';

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(file);
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => { hash.update(chunk); });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function run(): Promise<void> {
  loadEnvFiles();
  const projectConfig = (await import('../config')).default;
  if (projectConfig.secretManager?.url) {
    const secretManager = await import('@luckystack/secret-manager');
    await secretManager.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  }

  const prisma = getPrismaClient();
  const { backupDir, runBackup } = await import('../server/db/backup');
  const { backupAssets, encKeyMatches } = await import('../server/db/backupAssets');
  const backup = await runBackup(prisma);
  if (!backup.ok || !backup.file) throw new Error(backup.error ?? 'database backup failed');

  const stamp = path.basename(backup.file, '.ndjson.gz').replace('backup-', '');
  const snapshotDir = path.join(backupDir(), `snapshot-${stamp}`);
  await mkdir(snapshotDir, { recursive: true });
  const assets = await backupAssets(snapshotDir);
  if (!assets.ok) throw new Error(assets.error ?? 'asset backup failed');
  const keyCheck = encKeyMatches(assets.encKeyFingerprint);
  if (!keyCheck.matches) throw new Error(keyCheck.reason);

  const archiveChecksums = await Promise.all(assets.archives.map(async (archive) => ({
    ...archive,
    sha256: await sha256(path.join(snapshotDir, `${archive.name}.tar.gz`)),
  })));
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    database: {
      file: path.relative(snapshotDir, backup.file),
      collections: backup.collections,
      docs: backup.docs,
      sha256: await sha256(backup.file),
    },
    assets: archiveChecksums,
    skippedAssets: assets.skipped,
    encKeyFingerprint: assets.encKeyFingerprint,
    encKeyCheck: keyCheck.reason,
  };
  const manifestFile = path.join(snapshotDir, 'manifest.json');
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await prisma.$disconnect();
  console.log(JSON.stringify({ ok: true, manifestFile, ...manifest }, null, 2));
}

const [error] = await tryCatch(run);
if (error) {
  console.error(`[backup] ${error.message}`);
  process.exit(1);
}
process.exit(0);
