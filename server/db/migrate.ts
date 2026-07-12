//? User-app DB migrations (ADR 0043, D1) — apply a schema migration to an environment's DB as a GATED
//? control-op. dev applies freely; **prod requires an explicit approval AND a recorded rollback plan**
//? (B-23 + the "prod apply = approval + backup/rollback" decision). The SQL runs via the environment's
//? `DbConnection` (decrypted only here) in a throwaway DB-client container (the base image has
//? psql/mysql/mongosh). Best-effort: no connection / no docker / a SQL error lands on the Migration row as
//? `status:'failed'` + `error` — never throws. The Conductor calls this (the only writer, B-23).

import type { PrismaClient } from '@prisma/client';

import { decryptSecret } from '../crypto/secretBox';
import { docker, dockerAvailable } from '../container/runtime';

const BASE_IMAGE = process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0';
const NET = process.env.WS_NET ?? 'workspaces-net';

export interface MigrateResult { ok: boolean; status: string; error?: string }

//? The DB-client invocation per engine (the URL carries auth; `-c`/`--eval` runs the statement).
function clientCommand(kind: string, url: string, sql: string): string {
  if (kind === 'mysql') return `mysql "${url}" -e ${shellQuote(sql)}`;
  if (kind === 'mongo') return `mongosh "${url}" --quiet --eval ${shellQuote(sql)}`;
  return `psql "${url}" -v ON_ERROR_STOP=1 -c ${shellQuote(sql)}`;   // postgres default
}
const shellQuote = (s: string): string => `'${s.replaceAll("'", String.raw`'\''`)}'`;

//? Apply a migration to its target environment's DB. Gated: prod needs `approved` + a rollback plan.
export async function applyMigration(prisma: PrismaClient, workspaceId: string, migrationId: string, opts: { approved?: boolean } = {}): Promise<MigrateResult> {
  const migration = await prisma.migration.findFirst({ where: { workspaceId, id: migrationId } });
  if (!migration) return { ok: false, status: 'error', error: 'migration.notFound' };
  if (migration.status === 'applied') return { ok: true, status: 'applied' };

  //? prod gate (B-23): explicit approval + a recorded rollback plan (no un-undoable prod change).
  if (migration.envKind === 'prod' && opts.approved !== true) return { ok: false, status: 'blocked', error: 'migration.prodNeedsApproval' };
  if (migration.envKind === 'prod' && (migration.rollbackSql ?? '').trim().length === 0) return { ok: false, status: 'blocked', error: 'migration.prodNeedsRollbackPlan' };

  const conn = await prisma.dbConnection.findFirst({ where: { workspaceId, projectId: migration.projectId, envKind: migration.envKind }, orderBy: { createdAt: 'desc' } });
  if (!conn) return failMigration(prisma, migrationId, 'db.noConnection');
  if (!(await dockerAvailable())) return failMigration(prisma, migrationId, 'docker.unavailable');

  const url = decryptSecret(conn.urlEnc) ?? conn.urlEnc;
  const cmd = clientCommand(conn.kind, url, migration.sql);
  //? Throwaway DB-client container on the shared net so it can reach a same-host env DB.
  const res = await docker(['run', '--rm', '--network', NET, BASE_IMAGE, 'sh', '-lc', cmd]);
  if (res.code !== 0) return failMigration(prisma, migrationId, `migration.applyFailed: ${res.err.slice(0, 200)}`);

  await prisma.migration.update({ where: { id: migrationId }, data: { status: 'applied', appliedAt: new Date(), error: null } });
  return { ok: true, status: 'applied' };
}

async function failMigration(prisma: PrismaClient, migrationId: string, error: string): Promise<MigrateResult> {
  await prisma.migration.update({ where: { id: migrationId }, data: { status: 'failed', error } });
  return { ok: false, status: 'failed', error };
}

export interface IntrospectResult { ok: boolean; tables: string[]; error?: string }

//? The read-only DB explorer (ADR 0043) — list a connection's tables/collections via a throwaway
//? DB-client container. READ-ONLY (a listing query, never a write). Best-effort: no connection / no docker
//? / a query error yields `{ ok:false }`. The first, safest cut of the explorer (browse before edit).
export async function introspectDb(prisma: PrismaClient, workspaceId: string, connectionId: string): Promise<IntrospectResult> {
  const conn = await prisma.dbConnection.findFirst({ where: { workspaceId, id: connectionId } });
  if (!conn) return { ok: false, tables: [], error: 'db.noConnection' };
  if (!(await dockerAvailable())) return { ok: false, tables: [], error: 'docker.unavailable' };
  const url = decryptSecret(conn.urlEnc) ?? conn.urlEnc;
  const listCmd = conn.kind === 'mysql'
    ? `mysql "${url}" -N -e 'show tables'`
    : (conn.kind === 'mongo'
      ? String.raw`mongosh "${url}" --quiet --eval 'db.getCollectionNames().join("\n")'`
      : `psql "${url}" -At -c "select tablename from pg_tables where schemaname='public'"`);
  const res = await docker(['run', '--rm', '--network', NET, BASE_IMAGE, 'sh', '-lc', listCmd]);
  if (res.code !== 0) return { ok: false, tables: [], error: res.err.slice(0, 200) };
  return { ok: true, tables: res.out.split('\n').map((t) => t.trim()).filter((t) => t.length > 0).slice(0, 500) };
}
