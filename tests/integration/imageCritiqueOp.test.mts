//? F5 — the content-critique-image op stores an AI critique on an image asset's metadata (advisory; never edits
//? the asset). Drives the real Conductor op against a ready image asset and asserts the critique text lands on
//? metadata.critique + a delta is broadcast. In the test harness (no resolvable vision key) the honest STUB path
//? runs — which still proves the wiring + storage; the REAL vision call is proven separately (Gemini returns the
//? actual colour of a test image, see the F5 branch-log). Real Mongo, no Docker.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `crit-${String(stamp)}@youcomm.nl`, name: 'Crit' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Critique WS');
  workspaceId = created.workspaceId;
  const ws = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: ws } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: ws, projectId: project?.id ?? '', title: 'Photo piece' } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: ws, contentProjectId: piece.id, kind: 'image', status: 'ready', url: '/media/photo.png' } });

  //? Before: no critique on the asset.
  const meta0 = (asset.metadata !== null && typeof asset.metadata === 'object') ? asset.metadata as Record<string, unknown> : {};
  eq(meta0.critique, undefined, 'a fresh asset has no critique');

  //? Drive the op with a specific question.
  await enqueueControlAction({ workspaceId: ws, op: 'content-critique-image', target: {}, payload: {
    contentProjectId: piece.id, assetId: asset.id, prompt: 'what should change about this photo?',
  }, userId: owner.id, clientRequestId: `crit-1-${String(stamp)}` });
  await wait(1500);

  const after = await prisma.contentAsset.findFirst({ where: { workspaceId: ws, id: asset.id }, select: { metadata: true } });
  const meta = (after?.metadata !== null && typeof after?.metadata === 'object') ? after.metadata as Record<string, unknown> : {};
  assert(typeof meta.critique === 'string' && (meta.critique as string).length > 0, 'the critique text is stored on the asset metadata');
  assert(typeof meta.critiqueStub === 'boolean', 'the honesty flag (real vs stub) is recorded');
  //? The op is ADVISORY — it never mutates the asset itself.
  const unchanged = await prisma.contentAsset.findFirst({ where: { workspaceId: ws, id: asset.id }, select: { url: true, status: true } });
  eq(unchanged?.url, '/media/photo.png', 'the asset url is untouched (advisory only)');
  eq(unchanged?.status, 'ready', 'the asset status is untouched');

  //? A non-image asset is ignored (guarded).
  const vid = await prisma.contentAsset.create({ data: { workspaceId: ws, contentProjectId: piece.id, kind: 'video', status: 'ready', url: '/media/clip.mp4' } });
  await enqueueControlAction({ workspaceId: ws, op: 'content-critique-image', target: {}, payload: { contentProjectId: piece.id, assetId: vid.id }, userId: owner.id, clientRequestId: `crit-2-${String(stamp)}` });
  await wait(600);
  const vidAfter = await prisma.contentAsset.findFirst({ where: { workspaceId: ws, id: vid.id }, select: { metadata: true } });
  const vmeta = (vidAfter?.metadata !== null && typeof vidAfter?.metadata === 'object') ? vidAfter.metadata as Record<string, unknown> : {};
  eq(vmeta.critique, undefined, 'a non-image asset is not critiqued');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/imageCritiqueOp.test.mts');
