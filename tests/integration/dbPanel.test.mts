//? ADR 0043 — the DB panel ops PERSIST through the REAL Conductor + Mongo, and surface in the snapshot the
//? panel renders from. Verifies: db-connect stores an (encrypted-URL) DbConnection, db-migrate-create stores a
//? pending Migration, both appear in `buildSnapshot().dbConnections/.migrations`, and db-migrate-apply moves the
//? row off `pending` (→ `failed` here since no docker/db in the test box — the point is the op runs + records).
//? The panel's UI wiring (ctx → projectAdmin op) is the same enqueue path this drives. Cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `dbp-${String(stamp)}@youcomm.nl`, name: 'DbP' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'DbP WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const project = await prisma.project.create({ data: { workspaceId: wsId, name: 'App', projectType: 'dev', gitlabPath: 'dbp/app' } });

  // 1) db-connect → a persisted DbConnection with an ENCRYPTED url (never the plaintext).
  const rawUrl = 'postgres://u:p@localhost:5432/app';
  await enqueueControlAction({ workspaceId: wsId, op: 'db-connect', target: { projectId: project.id }, payload: { projectId: project.id, name: 'primary', kind: 'postgres', url: rawUrl, envKind: 'dev' }, userId: owner.id, clientRequestId: `dbp-c-${String(stamp)}` });
  const conn = await poll(() => prisma.dbConnection.findFirst({ where: { workspaceId: wsId, projectId: project.id, name: 'primary' } }));
  assert(conn !== null, 'the DbConnection persisted');
  eq(conn?.kind, 'postgres', 'the connection kind was stored');
  assert((conn?.urlEnc ?? '') !== rawUrl && (conn?.urlEnc ?? '').length > 0, 'the url is stored ENCRYPTED, never plaintext');

  // 2) db-migrate-create → a pending Migration row.
  await enqueueControlAction({ workspaceId: wsId, op: 'db-migrate-create', target: { projectId: project.id }, payload: { projectId: project.id, name: 'add-users', sql: 'CREATE TABLE users (id int);', envKind: 'dev' }, userId: owner.id, clientRequestId: `dbp-m-${String(stamp)}` });
  const mig = await poll(() => prisma.migration.findFirst({ where: { workspaceId: wsId, projectId: project.id, name: 'add-users' } }));
  assert(mig !== null, 'the Migration persisted');
  eq(mig?.status, 'pending', 'a fresh migration is pending');

  // 3) both surface in the snapshot the panel renders from (active project scoped).
  const snap = await buildSnapshot(prisma, owner.id, wsId, project.id);
  assert(snap.dbConnections.some((c) => c.name === 'primary' && c.kind === 'postgres'), 'the connection is in the snapshot');
  assert(snap.migrations.some((m) => m.name === 'add-users' && m.status === 'pending'), 'the pending migration is in the snapshot');
  assert(!JSON.stringify(snap.dbConnections).includes(rawUrl), 'the snapshot NEVER leaks the plaintext url');

  // 4) db-migrate-apply → the op runs + moves the row off pending (failed here: no docker/db box).
  await enqueueControlAction({ workspaceId: wsId, op: 'db-migrate-apply', target: { migrationId: mig?.id ?? '' }, payload: { migrationId: mig?.id ?? '' }, userId: owner.id, clientRequestId: `dbp-a-${String(stamp)}` });
  const applied = await poll(async () => {
    const row = await prisma.migration.findFirst({ where: { id: mig?.id ?? '' }, select: { status: true } });
    return row && row.status !== 'pending' ? row : null;
  });
  assert(applied !== null, 'db-migrate-apply ran and recorded a terminal status (applied/failed), not left pending');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/dbPanel.test.mts');
