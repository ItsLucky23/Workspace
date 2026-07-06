//? Integration test for F5.1 (per-channel brand-RAG + content-analytics, ADR 0071). Real Mongo (+ the
//? offline embedder, no key). Brand snippets index under a per-channel sentinel + retrieve for that channel
//? only; the content-analytics fold is asserted against hand-computed values (pure). Self-cleans.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { indexChannelBrand, retrieveChannelBrand, brandCommit } = await import('../../server/content/brandMemory');
const { computeContentAnalytics } = await import('../../server/content/contentAnalytics');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

// ---- content-analytics fold (pure, no DB) ---------------------------------------------------------
const analytics = computeContentAnalytics(
  [
    { stageId: 'publish', status: 'done', format: 'faceless', archived: false },
    { stageId: 'script', status: 'busy', format: 'faceless', archived: false },
    { stageId: 'idea', status: 'idle', format: 'short', archived: false },
    { stageId: 'idea', status: 'idle', format: 'short', archived: true },   // archived → excluded
  ],
  [{ feature: 'image-gen', costCents: 16 }, { feature: 'tts', costCents: 2 }, { feature: 'image-gen', costCents: 4 }],
  [{ status: 'done' }, { status: 'error' }],
);
eq(analytics.totalPieces, 3, 'archived pieces are excluded from the fold');
eq(analytics.doneCount, 1, 'one piece is done');
eq(analytics.publishedCount, 1, 'one publish job succeeded');
eq(analytics.byFormat.find((f) => f.format === 'faceless')?.count, 2, 'by-format counts faceless twice');
eq(analytics.totalCostCents, 22, 'total metered cost = 16+2+4 = 22c');
eq(analytics.costByFeature[0]?.feature, 'image-gen', 'cost-by-feature is sorted (image-gen 20c on top)');
eq(analytics.costByFeature[0]?.cents, 20, 'image-gen cost folds 16+4 = 20c');

// ---- per-channel brand memory (real store + offline embedder) -------------------------------------
const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f51-${String(stamp)}@youcomm.nl`, name: 'CP F51' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F51 WS' }, userId: owner.id, clientRequestId: `f51-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  const channelA = 'chan-a';
  const channelB = 'chan-b';
  const res = await indexChannelBrand(prisma, wsId, channelA, [
    'Our brand voice is bold, playful and energetic — we open on a strong hook.',
    'The palette is warm: coral, cream and deep navy. Rounded, friendly type.',
    'We always end on a clear call to action and a memorable tagline.',
  ]);
  eq(res.entries, 3, 'the channel brand indexed 3 snippets');
  eq(await prisma.ragEntry.count({ where: { workspaceId: wsId, commitHash: brandCommit(channelA) } }), 3, 'the snippets are stored under the per-channel sentinel');

  const hits = await retrieveChannelBrand(prisma, wsId, channelA, 'what is our brand voice and tone?', 3);
  assert(hits.length > 0, 'brand retrieval returns chunks that can condition a generation');
  assert(hits.some((h) => h.content.toLowerCase().includes('voice')), 'the retrieved brand includes the voice snippet');

  //? A different channel has its OWN (empty) brand — no cross-channel leakage.
  eq((await retrieveChannelBrand(prisma, wsId, channelB, 'brand voice?', 3)).length, 0, 'a channel with no brand indexed retrieves nothing (per-channel isolation)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentMemory.test.mts');
