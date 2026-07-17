//? DB backup + restore round-trip against the REAL Mongo (gap-scan: geen backup-automatisering / geen
//? restore-pad). Scoped to a throwaway collection (runBackup `only`) so the shared dev DB is untouched.
//? Verifies: >600 docs stream through getMore paging, the gzip NDJSON lands on disk, restore after a
//? drop brings every document back with ObjectId + Date fidelity (Extended JSON round-trip), and the
//? keep-N retention prunes old files.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { db, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { runBackup, restoreBackup, pruneBackups } = await import('../../server/db/backup.ts');

const COLL = `ws_backup_test_${String(Date.now())}`;
const dir = mkdtempSync(path.join(tmpdir(), 'ws-backup-'));
process.env.WS_BACKUP_DIR = dir;

try {
  //? 700 docs (crosses the 500 batch boundary) with an ObjectId _id + a real Date field.
  const docs = Array.from({ length: 700 }, (_, i) => ({ n: i, label: `doc-${String(i)}`, at: { $date: new Date(1_700_000_000_000 + i * 1000).toISOString() } }));
  await prisma.$runCommandRaw({ insert: COLL, documents: docs });

  const backup = await runBackup(prisma, { only: [COLL] });
  assert(backup.ok && backup.file !== undefined, 'backup wrote a file');
  eq(backup.collections, 1, 'only the scoped collection was dumped');
  eq(backup.docs, 700, 'all 700 docs streamed through (the _id-paging crosses the 500 batch)');

  //? Wipe the collection, then restore.
  await prisma.$runCommandRaw({ drop: COLL });
  const restored = await restoreBackup(prisma, backup.file ?? '');
  assert(restored.ok, 'restore succeeded');
  eq(restored.docs, 700, 'restore re-inserted all 700 docs');

  const count = (await prisma.$runCommandRaw({ count: COLL })) as unknown as { n?: number };
  eq(count.n, 700, 'the collection holds 700 docs again');
  const probe = (await prisma.$runCommandRaw({ find: COLL, filter: { n: 123 }, batchSize: 1 })) as unknown as { cursor?: { firstBatch?: { label?: string; at?: unknown; _id?: unknown }[] } };
  const row = probe.cursor?.firstBatch?.[0];
  eq(row?.label, 'doc-123', 'document content survived the round-trip');
  assert(row?.at !== null && typeof row?.at === 'object' && '$date' in (row.at as object), 'the Date field is still a real BSON Date (not a string)');
  assert(row?._id !== null && typeof row?._id === 'object' && '$oid' in (row._id as object), 'the _id is still a real ObjectId');

  //? Retention: with WS_BACKUP_KEEP default 7, eleven files → four pruned.
  for (let i = 0; i < 10; i++) await runBackup(prisma, { only: [COLL], now: 1_700_000_000_000 + i * 60_000 });
  const left = readdirSync(dir).filter((f) => f.startsWith('backup-'));
  eq(left.length, 7, 'retention keeps the newest 7 backups');
} catch (error) {
  assert(false, `unexpected error during the run: ${error instanceof Error ? error.message.slice(0, 500) : String(error)}`);
} finally {
  await prisma.$runCommandRaw({ drop: COLL }).catch(() => null);
  rmSync(dir, { recursive: true, force: true });
  report('tests/integration/dbBackup.test.mts');
}
