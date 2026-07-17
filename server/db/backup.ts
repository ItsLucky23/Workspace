//? In-app DB backup + restore (gap-scan: geen backup-automatisering / geen restore-pad; ADR 0032 DR-mandaat).
//? Driver-less: dumps every collection through `prisma.$runCommandRaw` (find/getMore) as Extended JSON —
//? which round-trips ObjectId/Date faithfully back through `insert` — gzipped NDJSON into WS_BACKUP_DIR
//? with keep-N retention. Restore reverses it (drop + insert per collection) and is DESTRUCTIVE — the
//? operator entrypoint (`npm run db:restore`) requires an explicit --yes. NOTE: this protects DATA only;
//? WORKSPACES_ENC_KEY must be backed up separately (DR_RUNBOOK §3) or encrypted secrets stay unreadable.

import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createGunzip, createGzip } from 'node:zlib';
import type { PrismaClient } from '@prisma/client';

import { jsonInputObject } from '../util/json';

//? Daily by default; WS_BACKUP_INTERVAL_HOURS=0 disables the loop entirely.
const INTERVAL_HOURS = Number(process.env.WS_BACKUP_INTERVAL_HOURS ?? '24');
export const BACKUP_INTERVAL_MS = Math.max(1, INTERVAL_HOURS) * 3_600_000;
export const BACKUP_ENABLED = Number.isFinite(INTERVAL_HOURS) && INTERVAL_HOURS > 0;
const KEEP = Math.max(1, Number(process.env.WS_BACKUP_KEEP ?? '7'));
const BATCH = 500;

export function backupDir(): string {
  return process.env.WS_BACKUP_DIR ?? path.join(process.cwd(), 'data', 'backups');
}

//? Runtime narrowing for the raw command responses (the strict no-cast posture: guard, don't assert).
function asRecord(v: unknown): Record<string, unknown> {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}
function cursorBatch(res: unknown, key: 'firstBatch' | 'nextBatch'): unknown[] {
  const raw = asRecord(asRecord(res).cursor)[key];
  return Array.isArray(raw) ? raw : [];
}

//? All user collections (system.* excluded).
export async function listCollections(prisma: PrismaClient): Promise<string[]> {
  const res: unknown = await prisma.$runCommandRaw({ listCollections: 1, nameOnly: true });
  return cursorBatch(res, 'firstBatch')
    .map((c) => { const name = asRecord(c).name; return typeof name === 'string' ? name : ''; })
    .filter((n) => n.length > 0 && !n.startsWith('system.'));
}

export interface BackupResult { ok: boolean; file?: string; collections: number; docs: number; error?: string }

//? One full backup: NDJSON (line 1 = meta, then {c,d} per document), gzip-streamed, then keep-N pruning.
//? `only` narrows the dump to specific collections (tests / targeted exports); absent = everything.
export async function runBackup(prisma: PrismaClient, opts: { now?: number; only?: string[] } = {}): Promise<BackupResult> {
  const dir = backupDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date(opts.now ?? Date.now()).toISOString().replaceAll(/[:.]/g, '-');
  const file = path.join(dir, `backup-${stamp}.ndjson.gz`);

  const gz = createGzip();
  const out = createWriteStream(file);
  gz.pipe(out);
  const write = (line: string): Promise<void> => new Promise((resolve) => {
    if (gz.write(`${line}\n`)) resolve();
    else gz.once('drain', () => { resolve(); });
  });

  const all = await listCollections(prisma);
  const collections = opts.only ? all.filter((c) => opts.only?.includes(c)) : all;
  await write(JSON.stringify({ v: 1, createdAt: new Date(opts.now ?? Date.now()).toISOString(), collections, note: 'WORKSPACES_ENC_KEY is NOT in this backup — store it separately (DR_RUNBOOK §3).' }));

  //? Cursor-less paging: `getMore` needs the int64 cursor id, which mangles through JSON number
  //? precision — instead page by `_id > last` with `singleBatch` (the EJSON `_id` round-trips exactly).
  let docs = 0;
  for (const coll of collections) {
    let lastId: unknown = null;
    for (;;) {
      const res: unknown = await prisma.$runCommandRaw(jsonInputObject({
        find: coll, sort: { _id: 1 }, limit: BATCH, batchSize: BATCH, singleBatch: true,
        ...(lastId === null ? {} : { filter: { _id: { $gt: lastId } } }),
      }));
      const batch = cursorBatch(res, 'firstBatch');
      for (const d of batch) { await write(JSON.stringify({ c: coll, d })); docs += 1; }
      if (batch.length < BATCH) break;
      lastId = asRecord(batch.at(-1))._id ?? null;
      if (lastId === null) break;
    }
  }

  await new Promise<void>((resolve, reject) => { out.on('close', () => { resolve(); }); out.on('error', reject); gz.end(); });
  pruneBackups(dir);
  return { ok: true, file, collections: collections.length, docs };
}

//? Keep the newest KEEP backup files (name-sorted = time-sorted by the ISO stamp).
export function pruneBackups(dir: string): string[] {
  const files = readdirSync(dir).filter((f) => f.startsWith('backup-') && f.endsWith('.ndjson.gz')).toSorted();
  const drop = files.slice(0, Math.max(0, files.length - KEEP));
  for (const f of drop) unlinkSync(path.join(dir, f));
  return drop;
}

export interface RestoreResult { ok: boolean; collections: number; docs: number; error?: string }

//? DESTRUCTIVE restore: for every collection present in the backup, drop it and re-insert its documents
//? (Extended JSON in = BSON types restored). Collections not in the backup are left untouched.
export async function restoreBackup(prisma: PrismaClient, file: string): Promise<RestoreResult> {
  if (!existsSync(file)) return { ok: false, collections: 0, docs: 0, error: 'backup.fileMissing' };
  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Number.POSITIVE_INFINITY });

  const dropped = new Set<string>();
  let pending: { coll: string; docs: unknown[] } | null = null;
  let docs = 0;

  const flush = async (): Promise<void> => {
    if (pending === null) return;
    if (pending.docs.length === 0) return;
    await prisma.$runCommandRaw(jsonInputObject({ insert: pending.coll, documents: pending.docs }));
    docs += pending.docs.length;
    pending.docs = [];
  };

  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    const row = JSON.parse(line) as { v?: number; c?: string; d?: unknown };
    if (typeof row.v === 'number') continue; //? the meta line
    if (typeof row.c !== 'string' || row.d === undefined) continue;
    if (!dropped.has(row.c)) {
      await prisma.$runCommandRaw({ drop: row.c }).catch(() => null); //? ns-not-found on a fresh DB is fine
      dropped.add(row.c);
    }
    if (pending !== null && pending.coll === row.c) {
      pending.docs.push(row.d);
    } else {
      await flush();
      pending = { coll: row.c, docs: [row.d] };
    }
    if (pending.docs.length >= BATCH) await flush();
  }
  await flush();
  return { ok: true, collections: dropped.size, docs };
}
