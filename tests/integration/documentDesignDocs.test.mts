//? DESIGN_DOCS_PROGRAM Phases 1 + 2 through the REAL Conductor + Mongo: the Document tool journey.
//? Covers: uploaded-source extraction (txt) → document-set-asset-text persists extractedText + indexes the
//? doc-assets RAG corpus; create-with-template seeds kind + skeleton; user-authorable template CRUD;
//? template-guided generation grounded on the uploaded source (LIVE Gemini leg when a key resolves);
//? revision restore; export (md/html); and the snapshot surface (documentTemplates + kind + revisions).

import { db, cleanupWorkspace, enableLiveProviders, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { DOC_ASSETS_CORPUS } = await import('../../server/documents/docs');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');
const { persistMediaBytes } = await import('../../server/media/store');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 12_000, stepMs = 100): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}
interface DocAsset { url: string; extractStatus?: string; extractedText?: string }
const findAsset = (assets: unknown, url: string): DocAsset | null => {
  if (!Array.isArray(assets)) return null;
  for (const a of assets) { if (a && typeof a === 'object' && (a as { url?: unknown }).url === url) return a as DocAsset; }
  return null;
};

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ddp-${String(stamp)}@youcomm.nl`, name: 'DDP' } });
let wsId = '';

try {
  wsId = (await createBlankWorkspace(prisma, owner.id, 'DesignDocs WS')).workspaceId;

  // ---- 1. create WITH a template → kind + section skeleton (2.1) ----
  await enqueueControlAction({ workspaceId: wsId, op: 'document-create', target: {}, payload: { title: 'Course project design', templateSlug: 'technical-design' }, userId: owner.id, clientRequestId: `c-${String(stamp)}` });
  const doc = await poll(() => prisma.document.findFirst({ where: { workspaceId: wsId, title: 'Course project design' } }));
  assert(doc !== null, 'document-create (templated) persisted the document');
  eq(doc?.kind, 'technical-design', 'the doc kind is the template slug');
  assert((doc?.content ?? '').includes('## Requirements') && (doc?.content ?? '').includes('## System decisions'), 'the template seeded a section skeleton');

  // ---- 2. attach an uploaded source file (txt) → extraction persists text + indexes doc-assets RAG (1.2/1.3) ----
  const src = persistMediaBytes(Buffer.from('ASSIGNMENT BRIEF\nBuild an offline-first study planner.\nRUBRIC: architecture 40%, UX 30%, code quality 30%.\nMUST support spaced-repetition scheduling.', 'utf8'), 'txt', `brief-${String(stamp)}`);
  await enqueueControlAction({ workspaceId: wsId, op: 'document-edit', target: {}, payload: { documentId: doc?.id, addAssetUrl: src.url, addAssetKind: 'file', addAssetLabel: 'Assignment brief' }, userId: owner.id, clientRequestId: `att-${String(stamp)}` });
  const extracted = await poll(async () => {
    const d = await prisma.document.findFirst({ where: { workspaceId: wsId, id: doc?.id ?? '' } });
    const a = findAsset(d?.assets, src.url);
    return a?.extractStatus === 'ok' ? a : null;
  });
  assert(extracted !== null, 'the uploaded txt was extracted (extractStatus ok) off the write lock');
  assert((extracted?.extractedText ?? '').includes('spaced-repetition'), 'the extracted text carries the source content');
  const assetRag = await poll(async () => { const n = await prisma.ragEntry.count({ where: { workspaceId: wsId, commitHash: DOC_ASSETS_CORPUS, filePath: { startsWith: `docasset/${doc?.id ?? ''}/` } } }); return n > 0 ? n : null; });
  assert((assetRag ?? 0) > 0, 'the source text indexed into the workspace-doc-assets corpus');

  // ---- 3. user-authorable templates (2.1, option B) ----
  await enqueueControlAction({ workspaceId: wsId, op: 'doc-template-save', target: {}, payload: { name: 'Meeting notes', description: 'quick notes', sections: [{ heading: 'Attendees', hint: 'who' }, { heading: 'Decisions', hint: 'what was decided' }] }, userId: owner.id, clientRequestId: `ts-${String(stamp)}` });
  const userTpl = await poll(() => prisma.documentTemplate.findFirst({ where: { workspaceId: wsId, name: 'Meeting notes' } }));
  assert(userTpl !== null, 'doc-template-save created a user template');
  await enqueueControlAction({ workspaceId: wsId, op: 'doc-template-delete', target: {}, payload: { slug: userTpl?.slug }, userId: owner.id, clientRequestId: `td-${String(stamp)}` });
  eq(await prisma.documentTemplate.count({ where: { workspaceId: wsId, slug: userTpl?.slug ?? '' } }), 0, 'doc-template-delete removed it');

  // ---- 4. snapshot surfaces the builtin template (virtual), kind + revisions ----
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  assert(snap.documentTemplates.some((t) => t.slug === 'technical-design' && t.builtin), 'snapshot lists the virtual builtin template');
  assert(snap.documents.some((d) => d.id === doc?.id && d.kind === 'technical-design'), 'snapshot carries the doc kind');

  // ---- 5. export (md + html run natively, no container) ----
  await enqueueControlAction({ workspaceId: wsId, op: 'document-edit', target: {}, payload: { documentId: doc?.id, content: '# Design\n\n## Overview\n\nA planner.\n\n## Architecture\n\n- offline-first\n\n[spec](https://example.com)\n\n```ts\nconst x=1;\n```' }, userId: owner.id, clientRequestId: `ed-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'document-export', target: {}, payload: { documentId: doc?.id, format: 'html' }, userId: owner.id, clientRequestId: `ex-${String(stamp)}` });
  const exported = await poll(async () => {
    const d = await prisma.document.findFirst({ where: { workspaceId: wsId, id: doc?.id ?? '' } });
    const has = Array.isArray(d?.assets) && d.assets.some((a) => a !== null && typeof a === 'object' && (a as { kind?: unknown }).kind === 'export');
    return has ? true : null;
  });
  assert(exported === true, 'document-export produced an export asset (html)');

  // ---- 6. revision restore (2.5) ----
  const before = await prisma.document.findFirst({ where: { workspaceId: wsId, id: doc?.id ?? '' } });
  const rev = await prisma.documentRevision.findFirst({ where: { workspaceId: wsId, documentId: doc?.id ?? '' }, orderBy: { createdAt: 'desc' } });
  assert(rev !== null, 'a revision exists to restore');
  await enqueueControlAction({ workspaceId: wsId, op: 'document-restore-revision', target: {}, payload: { documentId: doc?.id, revisionId: rev?.id }, userId: owner.id, clientRequestId: `rr-${String(stamp)}` });
  const restored = await poll(async () => {
    const d = await prisma.document.findFirst({ where: { workspaceId: wsId, id: doc?.id ?? '' } });
    return d && d.content === rev?.content && d.content !== before?.content ? d : null;
  });
  assert(restored !== null, 'document-restore-revision restored the prior content (and snapshotted current first)');

  // ---- 7. LIVE template-guided generation grounded on the uploaded source (only with a Gemini key) ----
  const live = enableLiveProviders();
  if (live.gemini) {
    await enqueueControlAction({ workspaceId: wsId, op: 'document-ai', target: {}, payload: { documentId: doc?.id, mode: 'generate', instruction: 'Write the technical design for this course project.' }, userId: owner.id, clientRequestId: `ai-${String(stamp)}` });
    const draft = await poll(async () => {
      const d = await prisma.document.findFirst({ where: { workspaceId: wsId, id: doc?.id ?? '' } });
      return d?.aiDraft ? d.aiDraft : null;
    }, 90_000, 500);
    assert(draft !== null, 'LIVE: template-guided document-ai produced a draft');
    const hits = ['Requirements', 'Architecture', 'System decisions'].filter((h) => (draft ?? '').includes(h)).length;
    assert(hits >= 2, 'LIVE: the draft follows the template structure (>=2 required section headings present)');
    assert(/spaced|repetition|planner|offline/i.test(draft ?? ''), 'LIVE: the draft is grounded on the uploaded brief content');
  } else {
    console.log('  (skipped LIVE generation leg — no Gemini key resolved)');
  }
} finally {
  //? Clean up the doc-assets RAG rows this test created (not in the shared cleanup list) + the workspace.
  if (wsId) await prisma.ragEntry.deleteMany({ where: { workspaceId: wsId, commitHash: DOC_ASSETS_CORPUS } });
  if (wsId) await prisma.documentTemplate.deleteMany({ where: { workspaceId: wsId } });
  if (wsId) await prisma.document.deleteMany({ where: { workspaceId: wsId } });
  if (wsId) await prisma.documentRevision.deleteMany({ where: { workspaceId: wsId } });
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('documentDesignDocs');
