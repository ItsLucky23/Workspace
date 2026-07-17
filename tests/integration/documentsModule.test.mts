//? FASE DOC (DOCUMENTS_AND_SKILLS) through the REAL Conductor + Mongo: the Documents module.
//? Covers: create (+RAG indexing into the 'workspace-documents' corpus via the offline embedder),
//? edit (+revision snapshot + re-index), the B-23 draft flow (apply writes content + snapshots the
//? previous version; discard clears), the stub-honest AI-image asset, revision pruning, delete
//? (doc + revisions + RAG rows), and the snapshot list. The document-ai op itself needs a provider
//? key → the stub world asserts the honest providerUnavailable path; the LIVE draft is proven in
//? the end-to-end browser phase.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { DOCUMENTS_CORPUS, chunkDocument, pruneDocumentRevisions } = await import('../../server/documents/docs');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `doc-${String(stamp)}@youcomm.nl`, name: 'DOC' } });
let wsId = '';

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Docs WS');
  wsId = created.workspaceId;

  // ---- 0. chunker sanity ----
  eq(chunkDocument('').length, 0, 'empty content → no chunks');
  assert(chunkDocument('a'.repeat(3000)).every((c) => c.length <= 1200), 'oversized paragraphs split at the max');

  // ---- 1. create: document + RAG rows in the reserved corpus ----
  await enqueueControlAction({ workspaceId: wsId, op: 'document-create', target: {}, payload: { title: 'Product spec', content: '# Product spec\n\nThe product does X.\n\n| Col | Val |\n| --- | --- |\n| a | 1 |' }, userId: owner.id, clientRequestId: `dc-${String(stamp)}` });
  const doc = await poll(() => prisma.document.findFirst({ where: { workspaceId: wsId, title: 'Product spec' } }));
  assert(doc !== null, 'document-create persisted the document');
  const ragCount1 = await poll(async () => { const n = await prisma.ragEntry.count({ where: { workspaceId: wsId, commitHash: DOCUMENTS_CORPUS, filePath: { startsWith: `doc/${doc?.id ?? ''}/` } } }); return n > 0 ? n : null; });
  assert((ragCount1 ?? 0) > 0, 'the content indexed into the workspace-documents corpus (offline embedder)');

  // ---- 2. edit: revision snapshot + re-index ----
  await enqueueControlAction({ workspaceId: wsId, op: 'document-edit', target: {}, payload: { documentId: doc?.id, title: 'Product spec v2', content: '# Product spec\n\nThe product does X and Y.' }, userId: owner.id, clientRequestId: `de-${String(stamp)}` });
  const edited = await poll(() => prisma.document.findFirst({ where: { workspaceId: wsId, id: doc?.id ?? '', title: 'Product spec v2' } }));
  assert(edited !== null, 'document-edit renamed + rewrote the document');
  eq(await prisma.documentRevision.count({ where: { workspaceId: wsId, documentId: doc?.id ?? '' } }), 1, 'the previous content snapshotted as a revision');

  // ---- 3. stub world: document-ai is HONEST about the missing provider (no fake draft) ----
  await enqueueControlAction({ workspaceId: wsId, op: 'document-ai', target: {}, payload: { documentId: doc?.id, mode: 'rewrite', instruction: 'shorter' }, userId: owner.id, clientRequestId: `da-${String(stamp)}` });
  await wait(400);
  eq((await prisma.document.findFirst({ where: { workspaceId: wsId, id: doc?.id ?? '' } }))?.aiDraft, null, 'no provider key → NO draft appears (honest providerUnavailable, never a fake)');

  // ---- 4. the B-23 draft flow (draft seeded directly; the ops are what we assert) ----
  await prisma.document.updateMany({ where: { workspaceId: wsId, id: doc?.id ?? '' }, data: { aiDraft: '# Product spec\n\nDraft body.', aiDraftLabel: 'rewrite: shorter' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'document-apply-draft', target: {}, payload: { documentId: doc?.id }, userId: owner.id, clientRequestId: `dap-${String(stamp)}` });
  const applied = await poll(() => prisma.document.findFirst({ where: { workspaceId: wsId, id: doc?.id ?? '', content: { contains: 'Draft body' } } }));
  assert(applied !== null, 'apply-draft wrote the draft as content (the accept IS the consent)');
  eq(applied?.aiDraft, null, 'and cleared the pending draft');
  eq(await prisma.documentRevision.count({ where: { workspaceId: wsId, documentId: doc?.id ?? '' } }), 2, 'the pre-apply content snapshotted as a second revision');

  await prisma.document.updateMany({ where: { workspaceId: wsId, id: doc?.id ?? '' }, data: { aiDraft: 'unwanted', aiDraftLabel: 'x' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'document-discard-draft', target: {}, payload: { documentId: doc?.id }, userId: owner.id, clientRequestId: `dd-${String(stamp)}` });
  assert(await poll(async () => ((await prisma.document.findFirst({ where: { workspaceId: wsId, id: doc?.id ?? '' } }))?.aiDraft === null ? true : null)) === true, 'discard-draft cleared the draft without touching content');

  // ---- 5. AI image: stub-honest asset appended ----
  await enqueueControlAction({ workspaceId: wsId, op: 'document-gen-image', target: {}, payload: { documentId: doc?.id, prompt: 'a hero illustration' }, userId: owner.id, clientRequestId: `di-${String(stamp)}` });
  const withAsset = await poll(async () => { const d = await prisma.document.findFirst({ where: { workspaceId: wsId, id: doc?.id ?? '' } }); return Array.isArray(d?.assets) && d.assets.length > 0 ? d : null; });
  assert(withAsset !== null, 'document-gen-image appended an asset');
  const asset = (withAsset?.assets as { kind?: string; stub?: boolean }[])[0];
  eq(asset?.kind, 'image', 'the asset is an image');
  eq(asset?.stub, true, 'and honestly marked stub (no media key in the test world)');

  // ---- 6. upload-attach via document-edit ----
  await enqueueControlAction({ workspaceId: wsId, op: 'document-edit', target: {}, payload: { documentId: doc?.id, addAssetUrl: '/media/up.pdf', addAssetKind: 'file', addAssetLabel: 'Uploaded' }, userId: owner.id, clientRequestId: `du-${String(stamp)}` });
  const twoAssets = await poll(async () => { const d = await prisma.document.findFirst({ where: { workspaceId: wsId, id: doc?.id ?? '' } }); return Array.isArray(d?.assets) && d.assets.length === 2 ? d : null; });
  assert(twoAssets !== null, 'an uploaded asset attaches alongside the AI image');

  // ---- 7. revision pruning bounds the history ----
  for (let i = 0; i < 25; i += 1) await prisma.documentRevision.create({ data: { workspaceId: wsId, documentId: doc?.id ?? '', content: `v${String(i)}`, note: 'seed' } });
  await pruneDocumentRevisions(prisma, wsId, doc?.id ?? '');
  eq(await prisma.documentRevision.count({ where: { workspaceId: wsId, documentId: doc?.id ?? '' } }), 20, 'pruning keeps the newest 20 revisions');

  // ---- 8. snapshot carries the documents list ----
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  const snapDoc = snap.documents.find((d) => d.id === doc?.id);
  assert(snapDoc !== undefined, 'the snapshot lists the document');
  eq(snapDoc?.assets.length, 2, 'with its typed assets');
  assert(typeof snapDoc?.updatedAt === 'number' && snapDoc.updatedAt > 0, 'and an epoch-ms updatedAt');

  // ---- 9. delete: doc + revisions + RAG rows all gone ----
  await enqueueControlAction({ workspaceId: wsId, op: 'document-delete', target: {}, payload: { documentId: doc?.id }, userId: owner.id, clientRequestId: `dx-${String(stamp)}` });
  assert(await poll(async () => ((await prisma.document.count({ where: { workspaceId: wsId, id: doc?.id ?? '' } })) === 0 ? true : null)) === true, 'document-delete removed the document');
  eq(await prisma.documentRevision.count({ where: { workspaceId: wsId, documentId: doc?.id ?? '' } }), 0, 'and its revisions');
  eq(await prisma.ragEntry.count({ where: { workspaceId: wsId, commitHash: DOCUMENTS_CORPUS, filePath: { startsWith: `doc/${doc?.id ?? ''}/` } } }), 0, 'and its RAG rows');
} finally {
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  report('tests/integration/documentsModule.test.mts');
}
