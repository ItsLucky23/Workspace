//? Test for FREEDOM_PROGRAM E1 (content-inpaint op) — the region-edit backend wiring. Verifies content-inpaint
//? runs the inpaint feature (source + mask + prompt) as a NEW asset, chains it to the source (I2 lineage), and
//? no-ops without a mask/prompt. Real Conductor + Mongo (stub media path without keys).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `inp-${String(stamp)}@youcomm.nl`, name: 'INP' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'INP WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: wsId, title: 'Piece' } });
  const source = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'image', url: '/media/src.png', status: 'ready' } });

  eq(await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: piece.id } }), 1, 'one asset (the source)');

  // region-edit → a NEW asset, chained to the source
  await enqueueControlAction({ workspaceId: wsId, op: 'content-inpaint', target: {}, payload: { contentProjectId: piece.id, referenceUrl: '/media/src.png', maskUrl: '/media/mask.png', prompt: 'make the sky purple', parentAssetId: source.id }, userId: owner.id, clientRequestId: `inp-1-${String(stamp)}` });
  await wait(400);
  eq(await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: piece.id } }), 2, 'a new region-edited asset was created');
  eq(await prisma.contentAsset.count({ where: { workspaceId: wsId, parentId: source.id } }), 1, 'the new asset chains to the source (I2 lineage)');

  // missing mask/prompt → no-op
  await enqueueControlAction({ workspaceId: wsId, op: 'content-inpaint', target: {}, payload: { contentProjectId: piece.id, referenceUrl: '/media/src.png' }, userId: owner.id, clientRequestId: `inp-2-${String(stamp)}` });
  await wait(200);
  eq(await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: piece.id } }), 2, 'a request without a mask/prompt does nothing');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentInpaint.test.mts');
