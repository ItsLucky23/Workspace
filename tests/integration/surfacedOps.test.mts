//? Integration test for the surfacing round: the write paths the new UI actually fires — the caption-style
//? persistence behind the piece UI (F2) and the asset-star op the shared picker uses (G4). Real Mongo,
//? real Conductor. (The G7 prompt-A/B ops were removed 2026-08-25.)

import { db, cleanupWorkspace, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { listLibrary } = await import('../../server/content/assetLibrary');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `srf-${String(stamp)}@youcomm.nl`, name: 'SRF' } });
let workspaceId: string | null = null;
let seq = 0;
const reqId = (tag: string): string => { seq += 1; return `srf-${tag}-${String(stamp)}-${String(seq)}`; };

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'SRF WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId }, select: { id: true } });
  const projectId = project?.id ?? wsId;

  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId, title: 'Surfaced piece' } });

  /* ---------------------------------------------- F2: the caption style the piece UI sends is persisted */
  await enqueueControlAction({
    workspaceId: wsId, op: 'content-run-pipeline', target: {}, userId: owner.id, clientRequestId: reqId('cc'),
    payload: { contentProjectId: piece.id, mode: 'video', captionMode: 'burn', captionStyle: { fontSize: 34, color: 'ffcc00', boxed: true, wordByWord: true } },
  });
  const styled = await prisma.contentProject.findUnique({ where: { id: piece.id }, select: { captionMode: true, captionStyle: true } });
  eq(styled?.captionMode, 'burn', 'the caption mode is stored');
  const style = styled?.captionStyle !== null && typeof styled?.captionStyle === 'object' ? styled.captionStyle as Record<string, unknown> : {};
  eq(style.fontSize, 34, 'the chosen size survives to the render');
  eq(style.wordByWord, true, 'as does the word-by-word choice');

  //? Junk is refused rather than stored: a bad value must never reach an ffmpeg filtergraph.
  await enqueueControlAction({
    workspaceId: wsId, op: 'content-run-pipeline', target: {}, userId: owner.id, clientRequestId: reqId('ccbad'),
    payload: { contentProjectId: piece.id, mode: 'video', captionStyle: { fontSize: 9000, color: 'drop table' } },
  });
  eq((await prisma.contentProject.findUnique({ where: { id: piece.id }, select: { captionStyle: true } }))?.captionStyle, null, 'an unusable style clears back to the plain default');

  /* ---------------------------------------------- G4: the picker's star op */
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'image', url: '/media/surf.png', status: 'ready' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'asset-star', target: {}, userId: owner.id, clientRequestId: reqId('star'), payload: { assetId: asset.id, starred: true } });
  eq((await listLibrary(prisma, wsId))[0]?.starred, true, 'starring from the picker reaches the library');
  await enqueueControlAction({ workspaceId: wsId, op: 'asset-star', target: {}, userId: owner.id, clientRequestId: reqId('unstar'), payload: { assetId: asset.id, starred: false } });
  eq((await listLibrary(prisma, wsId))[0]?.starred, false, 'and un-starring works too');
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId);
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('surfacedOps');
