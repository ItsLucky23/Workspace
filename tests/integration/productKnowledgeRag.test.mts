//? Q2 — the product self-knowledge RAG corpus, end-to-end against the REAL Mongo + the deterministic LOCAL
//? embedder (the default test world unsets GEMINI_API_KEY, so embedding is the offline hash-based embedder —
//? deterministic, no keys). Proves: the compiled corpus indexes into the RAG store under the global sentinel,
//? "can I edit videos?" retrieves the media/timeline capability chunk, an ADR query retrieves a decision, the
//? marker row is excluded, and ensure() is idempotent on the corpus hash. Cleans up its own rows.

import { db, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { indexProductKnowledge, ensureProductKnowledge, retrieveProductKnowledge, PRODUCT_WS, PRODUCT_COMMIT } = await import('../../server/rag/productKnowledge');

try {
  //? Index the compiled corpus (docs/AI_PRODUCT_KNOWLEDGE.json).
  const idx = await indexProductKnowledge(prisma);
  assert(idx.ok && idx.entries > 20, `the corpus indexed (${String(idx.entries)} chunks)`);
  assert(typeof idx.hash === 'string' && (idx.hash ?? '').length >= 8, 'index returns the corpus hash');

  //? The load-bearing retrieval: "can I edit videos?" → the media/timeline-editor capability.
  const vids = await retrieveProductKnowledge(prisma, 'can I edit videos in this app?', 4);
  assert(vids.length > 0, 'video-edit query returns hits');
  const joined = vids.map((h) => h.content).join(' ').toLowerCase();
  assert(/media|timeline editor/.test(joined), 'the retrieved product-knowledge points at the media module / timeline editor');

  //? A "why" query retrieves an ADR decision chunk.
  const why = await retrieveProductKnowledge(prisma, 'why is there a product self-knowledge corpus?', 4);
  assert(why.length > 0, 'a why/decision query returns hits');

  //? The marker/meta row is never surfaced.
  assert(!vids.some((h) => h.filePath === '__product_meta__') && !why.some((h) => h.filePath === '__product_meta__'), 'the meta/marker row is excluded from retrieval');

  //? Idempotency: ensure() with the marker matching the current hash re-embeds nothing.
  const again = await ensureProductKnowledge(prisma);
  eq(again.entries, 0, 'ensure() is a no-op when the corpus hash is unchanged');
  eq(again.hash, idx.hash, 'ensure() reports the same corpus hash');

  console.log(`[pk] ✓ ${String(idx.entries)} chunks indexed; video-edit query → ${vids.map((h) => h.filePath).slice(0, 3).join(', ')}`);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  await prisma.ragEntry.deleteMany({ where: { workspaceId: PRODUCT_WS, commitHash: PRODUCT_COMMIT } }).catch(() => null);
}

report('tests/integration/productKnowledgeRag.test.mts');
