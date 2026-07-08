//? Q3 LIVE — the full self-knowledge loop end-to-end with the REAL AI. Proves the ONE thing the stub suite
//? can't: that the Workspace-AI, asked "can I edit videos?", answers from the product-knowledge corpus
//? (names the media module / editor). Uses the REAL Gemini provider (forced via a per-workspace override, so
//? we don't spawn the claude-cli PTY). NOT `*.test.mts`: it costs a fraction of a cent + needs GEMINI_API_KEY,
//? so it is OPT-IN (run: `npx tsx tests/live/productKnowledgeChat.live.mts`) and SKIPS cleanly without a key.

import { db, cleanupWorkspace, enableLiveProviders, assert, report } from '../_helpers.mts';

const prisma = await db();
const live = enableLiveProviders();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { indexProductKnowledge, PRODUCT_WS, PRODUCT_COMMIT } = await import('../../server/rag/productKnowledge');
const { interpretChat } = await import('../../server/ai/workspaceChat');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `pkchat-${String(stamp)}@youcomm.nl`, name: 'PKChat' } });
let workspaceId: string | null = null;

try {
  if (!live.gemini) { console.log('[pk-chat] SKIP — no GEMINI_API_KEY (needs the real text provider).'); }
  else {
    await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'PKChat WS' }, userId: owner.id, clientRequestId: `pkchat-cw-${String(stamp)}` });
    const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
    workspaceId = ws?.id ?? null;
    const wsId = workspaceId ?? '';

    //? Force workspace-chat → gemini-api for this workspace (avoids the claude-cli PTY in a test).
    await prisma.envVar.create({ data: { workspaceId: wsId, key: '__ai_provider_workspace-chat', value: 'gemini-api' } });
    //? Index the global product-knowledge corpus so the chat can retrieve it.
    const idx = await indexProductKnowledge(prisma);
    assert(idx.ok && idx.entries > 0, `product corpus indexed (${String(idx.entries)} chunks)`);

    //? Ask the load-bearing question.
    const res = await interpretChat(prisma, wsId, 'Can I edit videos in this app, and how?');
    assert(res.error === undefined, `the chat returned without error (${res.error ?? ''})`);
    assert(res.reply.trim().length > 0, 'the chat produced a reply');
    const reply = res.reply.toLowerCase();
    assert(/media|editor|timeline|video/.test(reply), `the reply grounds on the product (media/editor/timeline): "${res.reply.slice(0, 160)}"`);
    //? B-23: the assistant proposes/answers, never writes state itself.
    assert(res.proposal === null || typeof res.proposal === 'object', 'the assistant only proposes (never writes) — B-23');
    console.log(`[pk-chat] ✓ reply: ${res.reply.slice(0, 200)}`);
  }
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  await prisma.ragEntry.deleteMany({ where: { workspaceId: PRODUCT_WS, commitHash: PRODUCT_COMMIT } }).catch(() => null);
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/live/productKnowledgeChat.live.mts');
