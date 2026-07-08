//? Inspiration library — add/retrieve/delete reference examples, end-to-end against the REAL Mongo + the
//? deterministic LOCAL embedder. Proves: reference-add persists + indexes into the workspace RAG, a brief
//? retrieves the relevant example, the snapshot exposes it, and reference-delete removes + de-indexes it.
//? Cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { retrieveReferences } = await import('../../server/content/referenceLibrary');
const { retrieve } = await import('../../server/rag/index');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `rf-${String(stamp)}@youcomm.nl`, name: 'RF' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'RF WS' }, userId: owner.id, clientRequestId: `rf-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? Add a reference example (a great ad the user collected).
  await enqueueControlAction({ workspaceId: wsId, op: 'reference-add', target: {}, payload: { kind: 'ad', title: 'Winning SaaS ad', description: 'A high-converting ad using problem-agitation-solution: opens on the pain, agitates the cost of inaction, then shows the product as the resolution with a single clear call-to-action.', assetUrl: '/media/ad-sample.mp4', tags: ['saas', 'conversion'] }, userId: owner.id, clientRequestId: `rf-1-${String(stamp)}` });
  const ref = await poll(() => prisma.referenceExample.findFirst({ where: { workspaceId: wsId, title: 'Winning SaaS ad' } }));
  assert(ref !== null, 'reference-add persists the example');
  eq(ref?.kind, 'ad', 'the example carries its kind');
  eq(ref?.assetUrl, '/media/ad-sample.mp4', 'the uploaded sample url is stored');

  //? The example is indexed → a relevant brief retrieves it.
  const hits = await poll(async () => { const h = await retrieveReferences(prisma, wsId, 'help me make a high-converting ad for my product', 3); return h.length > 0 ? h : null; });
  assert(hits !== null && hits.length > 0, 'a brief retrieves the reference example');
  assert(/problem-agitation-solution|call-to-action/i.test((hits ?? []).map((h) => h.content).join(' ')), 'the retrieved example carries its structure/approach');

  //? RAG isolation: the DEFAULT (no-ref) retrieve — used for CODE grounding — must NOT pick the 'reference'
  //? corpus even though it's the newest RagEntry write (else a reference example hijacks code questions).
  const codeGrounding = await retrieve(prisma, wsId, 'help me make a high-converting ad for my product', 3);
  assert(!codeGrounding.some((h) => h.filePath === ref?.id), 'the default (code) retrieve does NOT leak the reference corpus');

  //? The snapshot exposes the reference for the library UI.
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  assert(snap.content.references.some((r) => r.id === ref?.id && r.kind === 'ad'), 'the snapshot exposes the reference');

  //? reference-delete removes + de-indexes it.
  await enqueueControlAction({ workspaceId: wsId, op: 'reference-delete', target: {}, payload: { referenceId: ref?.id ?? '' }, userId: owner.id, clientRequestId: `rf-del-${String(stamp)}` });
  const gone = await poll(async () => { const r = await prisma.referenceExample.findUnique({ where: { id: ref?.id ?? '' } }); return r === null ? 'gone' : null; });
  eq(gone, 'gone', 'reference-delete removes the example');
  const after = await retrieveReferences(prisma, wsId, 'high-converting ad', 3);
  assert(!after.some((h) => h.filePath === ref?.id), 'the deleted example is de-indexed (no longer retrieved)');
  console.log(`[rf] ✓ reference add → retrieve → snapshot → delete/de-index`);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) { await prisma.referenceExample.deleteMany({ where: { workspaceId } }).catch(() => null); await prisma.ragEntry.deleteMany({ where: { workspaceId, commitHash: 'reference' } }).catch(() => null); await cleanupWorkspace(prisma, workspaceId, [owner.id]); }
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/referenceLibrary.test.mts');
