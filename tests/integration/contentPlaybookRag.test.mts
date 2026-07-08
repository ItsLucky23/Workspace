//? Best-practices — the content-playbook RAG corpus, end-to-end against the REAL Mongo + the deterministic
//? LOCAL embedder (test world unsets GEMINI_API_KEY). Proves: the curated playbook chunks + indexes under the
//? global sentinel, a hook query retrieves the hooks chunk, a thumbnail query the thumbnail chunk, the marker
//? is excluded, and ensure() is idempotent on the hash. Cleans up its own rows.

import { db, assert, report } from '../_helpers.mts';

const prisma = await db();
const { indexContentPlaybook, ensureContentPlaybook, retrieveContentPlaybook, PLAYBOOK_WS, PLAYBOOK_COMMIT } = await import('../../server/rag/contentPlaybook');

try {
  //? Chunk + index the curated playbook (docs/content-playbook/playbook.md).
  const idx = await indexContentPlaybook(prisma);
  assert(idx.ok && idx.entries >= 8, `the playbook indexed (${String(idx.entries)} chunks)`);
  assert(typeof idx.hash === 'string' && (idx.hash ?? '').length >= 8, 'index returns the corpus hash');

  //? A hook/opening query → the hooks best-practice.
  const hook = await retrieveContentPlaybook(prisma, 'how do I hook viewers in the first seconds of a video', 3);
  assert(hook.length > 0, 'a hook query returns hits');
  assert(/hook|3 seconds|retention/i.test(hook.map((h) => h.content).join(' ')), 'the retrieved best-practice is about hooks/retention');

  //? A thumbnail query → the thumbnail best-practice.
  const thumb = await retrieveContentPlaybook(prisma, 'what makes a good thumbnail with high contrast', 3);
  assert(/thumbnail|contrast|focal/i.test(thumb.map((h) => h.content).join(' ')), 'a thumbnail query retrieves the thumbnail best-practice');

  //? The marker row is never surfaced.
  assert(!hook.some((h) => h.filePath === '__playbook_meta__'), 'the meta/marker row is excluded from retrieval');

  //? Idempotency: ensure() is a no-op when the hash is unchanged.
  const again = await ensureContentPlaybook(prisma);
  assert(again.entries === 0 && again.hash === idx.hash, 'ensure() is a no-op when the playbook hash is unchanged');

  console.log(`[pb] ✓ ${String(idx.entries)} playbook chunks; hook query → ${hook.map((h) => h.filePath).slice(0, 3).join(', ')}`);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  await prisma.ragEntry.deleteMany({ where: { workspaceId: PLAYBOOK_WS, commitHash: PLAYBOOK_COMMIT } }).catch(() => null);
}

report('tests/integration/contentPlaybookRag.test.mts');
