//? Integration test for D1 (user-app DB support + migrations, ADR 0043). Runs against the REAL Conductor +
//? Mongo. Asserts db-connect stores an ENCRYPTED connection string, db-migrate-create records a migration,
//? and the GATED apply: prod needs approval AND a rollback plan; dev applies (best-effort — fails
//? gracefully without a live DB/docker, never throws). The real SQL execution is a live path.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}
async function op(workspaceId: string, o: string, target: Record<string, unknown>, payload: Record<string, unknown>, id: string): Promise<Record<string, unknown> | null> {
  const { result } = await enqueueControlAction({ workspaceId, op: o, target, payload, userId: 'sys', clientRequestId: id });
  return (result ?? null) as Record<string, unknown> | null;
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `db-test-${String(stamp)}@youcomm.nl`, name: 'DB Test' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'DB Test WS' }, userId: owner.id, clientRequestId: `db-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const proj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));
  const projId = proj?.id ?? '';

  // ---- db-connect stores an ENCRYPTED connection -------------------------------------------------
  const connRes = await op(wsId, 'db-connect', { projectId: projId }, { name: 'app db', kind: 'postgres', url: 'postgres://u:secret@db:5432/app', envKind: 'dev' }, `db-c-${String(stamp)}`);
  const connId = typeof connRes?.id === 'string' ? connRes.id : '';
  assert(connId.length > 0, 'db-connect creates a DbConnection');
  const conn = await prisma.dbConnection.findFirst({ where: { id: connId } });
  assert((conn?.urlEnc ?? '') !== 'postgres://u:secret@db:5432/app' && (conn?.urlEnc ?? '').length > 0, 'the connection string is stored ENCRYPTED (not plaintext)');

  // ---- db-migrate-create records a migration -----------------------------------------------------
  const devMig = await op(wsId, 'db-migrate-create', { projectId: projId }, { name: 'add users table', sql: 'CREATE TABLE users(id int);', envKind: 'dev' }, `db-mc-${String(stamp)}`);
  const devMigId = typeof devMig?.id === 'string' ? devMig.id : '';
  assert(devMigId.length > 0, 'db-migrate-create records a migration (status pending)');
  eq((await prisma.migration.findFirst({ where: { id: devMigId } }))?.status, 'pending', 'the migration starts pending');

  // ---- dev apply is best-effort (no live DB/docker → fails gracefully, transitions status) --------
  const devApply = await op(wsId, 'db-migrate-apply', { migrationId: devMigId }, {}, `db-ma-${String(stamp)}`);
  assert(devApply?.status === 'failed' || devApply?.status === 'applied', 'a dev apply resolves to a terminal status (never throws)');

  // ---- prod gate: needs a rollback plan AND approval ---------------------------------------------
  const prodMig = await op(wsId, 'db-migrate-create', { projectId: projId }, { name: 'drop col', sql: 'ALTER TABLE users DROP COLUMN x;', envKind: 'prod' }, `db-mcp-${String(stamp)}`);
  const prodMigId = typeof prodMig?.id === 'string' ? prodMig.id : '';
  const noRollback = await op(wsId, 'db-migrate-apply', { migrationId: prodMigId }, { approved: true }, `db-map1-${String(stamp)}`);
  eq(noRollback?.error, 'migration.prodNeedsRollbackPlan', 'a prod apply is blocked without a rollback plan');

  await prisma.migration.updateMany({ where: { id: prodMigId }, data: { rollbackSql: 'ALTER TABLE users ADD COLUMN x int;' } });
  const noApproval = await op(wsId, 'db-migrate-apply', { migrationId: prodMigId }, {}, `db-map2-${String(stamp)}`);
  eq(noApproval?.error, 'migration.prodNeedsApproval', 'a prod apply is blocked without an explicit approval (B-23)');

  //? With a rollback plan + approval the gate passes (then fails best-effort on the missing live DB — past the gate).
  const approved = await op(wsId, 'db-migrate-apply', { migrationId: prodMigId }, { approved: true }, `db-map3-${String(stamp)}`);
  assert(approved?.error !== 'migration.prodNeedsApproval' && approved?.error !== 'migration.prodNeedsRollbackPlan', 'an approved prod apply with a rollback plan passes the gate');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/dbMigrate.test.mts');
