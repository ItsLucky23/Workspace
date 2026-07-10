//? F7 — the content-video-restyle op (video-to-video "make it cinematic"). Drives the real Conductor op against
//? a source VIDEO asset + a style prompt and asserts a NEW video asset is produced (chained to the source for
//? lineage). In the test harness (no fal key) the honest STUB path runs — which still proves the op wiring +
//? feature-ripple (video-restyle is a real MediaFeature end-to-end). Real Mongo, no Docker/keys.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { estimateMediaCostCents } = await import('../../server/media/registry');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `vrs-${String(stamp)}@youcomm.nl`, name: 'VRS' } });
let workspaceId: string | null = null;

try {
  //? video-restyle is a real, costed MediaFeature (feature-ripple complete).
  assert(estimateMediaCostCents('video-restyle') > 0, 'video-restyle is a costed media feature');

  const created = await createBlankWorkspace(prisma, owner.id, 'Restyle WS');
  workspaceId = created.workspaceId;
  const ws = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: ws } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: ws, projectId: project?.id ?? '', title: 'Restyle piece' } });
  const source = await prisma.contentAsset.create({ data: { workspaceId: ws, contentProjectId: piece.id, kind: 'video', status: 'ready', url: '/media/source-clip.mp4' } });

  const before = await prisma.contentAsset.count({ where: { workspaceId: ws, contentProjectId: piece.id, kind: 'video' } });
  eq(before, 1, 'one source video to start');

  //? Restyle the source clip → a NEW video asset.
  await enqueueControlAction({ workspaceId: ws, op: 'content-video-restyle', target: {}, payload: {
    contentProjectId: piece.id, assetId: source.id, prompt: 'cinematic, warm colour grade, shallow depth of field',
  }, userId: owner.id, clientRequestId: `vrs-1-${String(stamp)}` });
  await wait(1500);

  const videos = await prisma.contentAsset.findMany({ where: { workspaceId: ws, contentProjectId: piece.id, kind: 'video' }, orderBy: { createdAt: 'asc' } });
  assert(videos.length === 2, 'a NEW restyled video asset was produced (source + restyle)');
  const restyled = videos.find((v) => v.id !== source.id);
  assert(restyled !== undefined, 'the restyled asset exists');
  //? I2 lineage — the restyle chains to its source.
  eq(restyled?.parentId, source.id, 'the restyled asset chains to the source (lineage)');
  //? The source is untouched.
  const src = await prisma.contentAsset.findFirst({ where: { id: source.id }, select: { url: true } });
  eq(src?.url, '/media/source-clip.mp4', 'the source clip is untouched');

  //? A missing prompt is a no-op (guarded).
  await enqueueControlAction({ workspaceId: ws, op: 'content-video-restyle', target: {}, payload: { contentProjectId: piece.id, assetId: source.id }, userId: owner.id, clientRequestId: `vrs-2-${String(stamp)}` });
  await wait(600);
  eq(await prisma.contentAsset.count({ where: { workspaceId: ws, contentProjectId: piece.id, kind: 'video' } }), 2, 'a restyle with no prompt is a no-op');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/videoRestyleOp.test.mts');
