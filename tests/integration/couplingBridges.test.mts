//? Integration test for the DB-backed halves of GAP_SCAN Phase C: the document archive/restore op (C7)
//? and attaching an EXISTING approved asset to a document instead of paying for a fresh generation (C2).
//? Both run through the real Conductor against real Mongo.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { dispatchControlSync } = await import('../../server/control/dispatchSync');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cpl-${String(stamp)}@youcomm.nl`, name: 'CPL' } });
let workspaceId: string | null = null;
let seq = 0;
const reqId = (tag: string): string => { seq += 1; return `cpl-${tag}-${String(stamp)}-${String(seq)}`; };

const docsInSnapshot = async (wsId: string): Promise<{ id: string; title: string; archived?: boolean }[]> => {
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  return snap.documents.map((d) => ({ id: d.id, title: d.title, ...(d.archived === true ? { archived: true } : {}) }));
};

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'CPL WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  const doc = await prisma.document.create({ data: { workspaceId: wsId, title: 'Technical design', content: '# Design\n\nBody.' } });
  await prisma.documentRevision.create({ data: { workspaceId: wsId, documentId: doc.id, content: '# Design', note: 'v1' } });

  /* ---------------------------------------------- C7: archive keeps everything, restore brings it back */
  await enqueueControlAction({ workspaceId: wsId, op: 'document-archive', target: {}, payload: { documentId: doc.id }, userId: owner.id, clientRequestId: reqId('arch') });
  const archived = await prisma.document.findUnique({ where: { id: doc.id }, select: { archived: true } });
  eq(archived?.archived, true, 'the document is archived');
  eq(await prisma.documentRevision.count({ where: { workspaceId: wsId, documentId: doc.id } }), 1, 'archiving keeps every revision (unlike delete)');

  const afterArchive = await docsInSnapshot(wsId);
  eq(afterArchive.length, 1, 'an archived document still ships in the snapshot (so it can be restored)');
  eq(afterArchive[0]?.archived, true, 'flagged as archived, so the list hides it by default');

  await enqueueControlAction({ workspaceId: wsId, op: 'document-unarchive', target: {}, payload: { documentId: doc.id }, userId: owner.id, clientRequestId: reqId('unarch') });
  eq((await prisma.document.findUnique({ where: { id: doc.id }, select: { archived: true } }))?.archived, false, 'restore un-archives it');
  eq((await docsInSnapshot(wsId))[0]?.archived, undefined, 'and the flag is gone from the snapshot');

  //? RBAC: the archive op is capability-gated like every other document write.
  const outsider = await prisma.user.create({ data: { email: `cpl-out-${String(stamp)}@youcomm.nl`, name: 'OUT' } });
  const denied = await dispatchControlSync({ op: 'document-archive', roomCode: wsId, userId: outsider.id, prisma, payload: { documentId: doc.id }, clientRequestId: reqId('deny') });
  assert(!denied.ok, 'a non-member cannot archive a document');
  eq((await prisma.document.findUnique({ where: { id: doc.id }, select: { archived: true } }))?.archived, false, 'and the document is untouched');
  await prisma.user.delete({ where: { id: outsider.id } }).catch(() => null);

  /* ---------------------------------------------- C2: reuse an approved asset (no generation, no spend) */
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: wsId, title: 'Launch clip' } });
  const ready = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'image', url: '/media/approved.png', status: 'ready' } });
  const pending = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'image', url: '/media/half-baked.png', status: 'pending' } });

  const spendBefore = await prisma.mediaSpend.count({ where: { workspaceId: wsId } });
  await enqueueControlAction({ workspaceId: wsId, op: 'document-gen-image', target: {}, payload: { documentId: doc.id, prompt: 'hero shot', assetId: ready.id }, userId: owner.id, clientRequestId: reqId('reuse') });

  const withAsset = await prisma.document.findUnique({ where: { id: doc.id }, select: { assets: true } });
  const assets = Array.isArray(withAsset?.assets) ? withAsset.assets : [];
  eq(assets.length, 1, 'the existing asset is attached to the document');
  assert(JSON.stringify(assets).includes('/media/approved.png'), 'and it is the approved asset, not a new render');
  eq(await prisma.mediaSpend.count({ where: { workspaceId: wsId } }), spendBefore, 'reusing costs nothing — no media spend recorded');

  //? A not-ready asset is refused (the client cannot promise state the server has not checked).
  await enqueueControlAction({ workspaceId: wsId, op: 'document-gen-image', target: {}, payload: { documentId: doc.id, prompt: 'x', assetId: pending.id }, userId: owner.id, clientRequestId: reqId('pending') });
  const afterPending = await prisma.document.findUnique({ where: { id: doc.id }, select: { assets: true } });
  eq((Array.isArray(afterPending?.assets) ? afterPending.assets : []).length, 1, 'a non-ready asset is not attached');

  //? Cross-tenant: an asset from ANOTHER workspace can never be attached.
  const other = await createBlankWorkspace(prisma, owner.id, 'CPL WS2');
  const otherPiece = await prisma.contentProject.create({ data: { workspaceId: other.workspaceId, projectId: other.workspaceId, title: 'Other' } });
  const foreign = await prisma.contentAsset.create({ data: { workspaceId: other.workspaceId, contentProjectId: otherPiece.id, kind: 'image', url: '/media/foreign.png', status: 'ready' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'document-gen-image', target: {}, payload: { documentId: doc.id, prompt: 'x', assetId: foreign.id }, userId: owner.id, clientRequestId: reqId('foreign') });
  const afterForeign = await prisma.document.findUnique({ where: { id: doc.id }, select: { assets: true } });
  assert(!JSON.stringify(afterForeign?.assets).includes('foreign.png'), 'an asset from another workspace is refused');
  await cleanupWorkspace(prisma, other.workspaceId);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId);
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('couplingBridges (integration)');
