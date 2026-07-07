//? Test for FREEDOM_PROGRAM S2 — undo / unpublish. Verifies content-unarchive restores an archived piece
//? (soft-undo, non-destructive) and content-unpublish retracts a done PublishJob (→ 'unpublished'). Real
//? Conductor + Mongo. Spend is monotonic — refunds are out of scope (flagged in the ADR).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `undo-${String(stamp)}@youcomm.nl`, name: 'UNDO' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'UNDO WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  // archive-undo
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: wsId, title: 'Piece', archived: true } });
  await enqueueControlAction({ workspaceId: wsId, op: 'content-unarchive', target: {}, payload: { contentProjectId: piece.id }, userId: owner.id, clientRequestId: `undo-1-${String(stamp)}` });
  eq((await prisma.contentProject.findUnique({ where: { id: piece.id } }))?.archived, false, 'content-unarchive restores the piece');

  // unpublish
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'video', url: '/media/v.mp4', status: 'ready' } });
  const job = await prisma.publishJob.create({ data: { workspaceId: wsId, contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', status: 'done', externalUrl: 'https://x.test/1' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'content-unpublish', target: {}, payload: { assetId: asset.id, platform: 'youtube' }, userId: owner.id, clientRequestId: `undo-2-${String(stamp)}` });
  eq((await prisma.publishJob.findUnique({ where: { id: job.id } }))?.status, 'unpublished', 'content-unpublish retracts the done job');

  // unpublish only touches the matching platform's DONE job
  const job2 = await prisma.publishJob.create({ data: { workspaceId: wsId, contentProjectId: piece.id, assetId: asset.id, platform: 'tiktok', status: 'done', externalUrl: 'https://x.test/2' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'content-unpublish', target: {}, payload: { assetId: asset.id, platform: 'youtube' }, userId: owner.id, clientRequestId: `undo-3-${String(stamp)}` });
  eq((await prisma.publishJob.findUnique({ where: { id: job2.id } }))?.status, 'done', 'a different platform job is untouched');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentUndo.test.mts');
