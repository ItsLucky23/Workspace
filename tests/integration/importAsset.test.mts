//? Integration test for FREEDOM_PROGRAM K1 — bring-your-own media. Verifies (a) persistMediaBytes writes a
//? file under MEDIA_DIR + returns a /media url, and (b) the content-import-asset control-op creates a `ready`
//? ContentAsset (no MediaJob) from a /media url, on the single-writer chain. The HTTP upload route itself
//? needs a running server (a dev action) and is covered manually. Real Conductor + Mongo.

import { existsSync } from 'node:fs';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { persistMediaBytes } = await import('../../server/media/store');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 6000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `imp-${String(stamp)}@youcomm.nl`, name: 'IMP' } });
let workspaceId: string | null = null;

try {
  // (a) persistMediaBytes writes a servable file
  const { url, path } = persistMediaBytes(Buffer.from('fake-image-bytes'), 'png', `test-${String(stamp)}`);
  assert(url.startsWith('/media/') && url.endsWith('.png'), 'persistMediaBytes returns a /media/<file>.png url');
  assert(existsSync(path), 'the file is written to MEDIA_DIR');

  // (b) content-import-asset creates a ready asset from the uploaded url
  const created = await createBlankWorkspace(prisma, owner.id, 'IMP WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: wsId, title: 'Piece' } });

  await enqueueControlAction({
    workspaceId: wsId, op: 'content-import-asset', target: { contentProjectId: piece.id },
    payload: { url, kind: 'image' }, userId: owner.id, clientRequestId: `imp-1-${String(stamp)}`,
  });
  const asset = await poll(() => prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: piece.id, url } }));
  assert(asset != null, 'the imported asset was created');
  eq(asset?.status, 'ready', 'an imported asset is immediately ready (no generation)');
  eq(asset?.kind, 'image', 'the kind is carried');
  assert(asset?.mediaJobId == null, 'an import has no MediaJob (it was not generated)');

  // a non-/media url is rejected (guard)
  await enqueueControlAction({ workspaceId: wsId, op: 'content-import-asset', target: { contentProjectId: piece.id }, payload: { url: 'https://evil.example/x.png', kind: 'image' }, userId: owner.id, clientRequestId: `imp-2-${String(stamp)}` });
  await wait(300);
  eq(await prisma.contentAsset.count({ where: { workspaceId: wsId, url: 'https://evil.example/x.png' } }), 0, 'a non-/media url is rejected');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/importAsset.test.mts');
