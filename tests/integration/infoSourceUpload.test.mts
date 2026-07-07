//? Integration test for FREEDOM_PROGRAM K2 — bring-your-own knowledge doc. Verifies the create-info-source
//? control-op registers an uploaded doc as a context-doc InfoSource (source='uploaded', enabled OFF), upserts
//? by name, and returns the full doc list. Real Conductor + Mongo.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 6000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `isu-${String(stamp)}@youcomm.nl`, name: 'ISU' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'ISU WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  await enqueueControlAction({ workspaceId: wsId, op: 'create-info-source', target: {}, payload: { name: 'house-style.md', content: 'Always write in British English.\nNever use exclamation marks.' }, userId: owner.id, clientRequestId: `isu-1-${String(stamp)}` });
  const doc = await poll(() => prisma.infoSource.findFirst({ where: { workspaceId: wsId, mode: 'context-doc', name: 'house-style.md' } }));
  assert(doc != null, 'the uploaded doc was registered as a context-doc InfoSource');
  eq(doc?.source, 'uploaded', 'the source is marked uploaded');
  eq(doc?.enabled, false, 'a new uploaded doc is OFF by default (user toggles it on)');
  assert((doc?.summary ?? '').includes('British English'), 'a summary is derived from the first line');

  // upsert by name (re-upload updates content, no duplicate)
  await enqueueControlAction({ workspaceId: wsId, op: 'create-info-source', target: {}, payload: { name: 'house-style.md', content: 'Updated: write in American English.' }, userId: owner.id, clientRequestId: `isu-2-${String(stamp)}` });
  await wait(300);
  eq(await prisma.infoSource.count({ where: { workspaceId: wsId, mode: 'context-doc', name: 'house-style.md' } }), 1, 'a re-upload upserts (no duplicate)');
  const updated = await prisma.infoSource.findFirst({ where: { workspaceId: wsId, mode: 'context-doc', name: 'house-style.md' } });
  assert((updated?.content ?? '').includes('American English'), 'the content was updated');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/infoSourceUpload.test.mts');
