//? Integration test for FREEDOM_PROGRAM I1 — regenerate / variations. Verifies the content-regenerate op
//? re-runs a produced asset's generation (from its MediaJob) as N NEW variation assets, on the single-writer
//? chain. No keys → the stub media path produces valid-shaped assets. Real Conductor + Mongo.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { generateMediaAsset } = await import('../../server/content/mediaAsset');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `crg-${String(stamp)}@youcomm.nl`, name: 'CRG' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'CRG WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: wsId, title: 'Piece' } });

  // seed one generated asset (stub path)
  const seed = await generateMediaAsset(prisma, { workspaceId: wsId, contentProjectId: piece.id, feature: 'model-3d', prompt: 'a red cube' });
  assert(seed.ok && seed.assetId != null, 'the seed asset was generated');
  eq(await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: piece.id } }), 1, 'one asset so far');

  // regenerate → 2 new variations
  await enqueueControlAction({ workspaceId: wsId, op: 'content-regenerate', target: {}, payload: { assetId: seed.assetId ?? '', count: '2', tweak: 'make it blue' }, userId: owner.id, clientRequestId: `crg-1-${String(stamp)}` });
  // the op awaits the gens inline; give the write a beat
  await wait(400);
  eq(await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: piece.id } }), 3, 'two variations added (1 + 2)');

  // an imported asset (no MediaJob) is NOT regenerable → the op no-ops
  const imported = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'image', url: '/media/x.png', status: 'ready', metadata: { imported: true } } });
  await enqueueControlAction({ workspaceId: wsId, op: 'content-regenerate', target: {}, payload: { assetId: imported.id, count: '2' }, userId: owner.id, clientRequestId: `crg-2-${String(stamp)}` });
  await wait(300);
  eq(await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: piece.id } }), 4, 'regenerating an imported asset does nothing (no MediaJob)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentRegenerate.test.mts');
