//? Integration test for E2 (RAG sharpen — institutional memory, ADR 0045). Runs against the REAL Conductor
//? + Mongo (+ the offline local embedder — no Gemini key needed). Asserts the pure Handoff/CarryOver text
//? renderers, that `index-memory` indexes prior learnings into the SAME RAG store under the memory sentinel,
//? and that `retrieveMemory` surfaces a relevant past learning — the whole point of institutional memory.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { handoffText, carryText, retrieveMemory, MEMORY_COMMIT } = await import('../../server/rag/memory');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

// ---- pure renderers -------------------------------------------------------------------------------
const ht = handoffText({ summary: 'chose Redis for sessions', decisions: ['use Redis'], gotchas: ['token expiry edge case'], next: [] });
assert(ht.includes('Redis') && ht.includes('Gotchas:') && ht.includes('token expiry'), 'handoffText renders summary + decisions + gotchas');
eq(handoffText(null), '', 'handoffText is empty for a missing body');
assert(carryText({ summary: 'add auth', openQuestions: ['which provider'] }).includes('which provider'), 'carryText renders summary + open questions');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `im-test-${String(stamp)}@youcomm.nl`, name: 'IM Test' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'IM Test WS' }, userId: owner.id, clientRequestId: `im-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const ticket = await poll(async () => { await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'IM Ticket' }, userId: owner.id, clientRequestId: `im-t-${String(stamp)}-${String(Date.now())}` }); return prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'IM Ticket' } }); });

  //? Seed a prior Handoff + CarryOver (the learnings to index).
  await prisma.handoff.create({ data: { workspaceId: wsId, sessionKey: 'worker:IM-1:code', ticketId: ticket?.id ?? null, body: { summary: 'we chose Redis for the session store', decisions: ['Redis over in-memory'], gotchas: ['the token expiry edge case bit us twice'], next: [] }, reason: 'budget' } });
  await prisma.carryOver.create({ data: { workspaceId: wsId, ticketId: ticket?.id ?? '', fromStageId: 'plan', toStageId: 'code', sessionId: ticket?.id ?? '', envelope: { summary: 'implement password reset', openQuestions: ['which email provider?'] } } });

  // ---- index-memory op indexes the learnings into the RAG store ----------------------------------
  const res = await enqueueControlAction({ workspaceId: wsId, op: 'index-memory', target: {}, payload: {}, userId: owner.id, clientRequestId: `im-idx-${String(stamp)}` });
  eq((res.result as Record<string, unknown> | null)?.entries, 2, 'index-memory indexes the Handoff + CarryOver');
  const memRows = await prisma.ragEntry.count({ where: { workspaceId: wsId, commitHash: MEMORY_COMMIT } });
  eq(memRows, 2, 'the memory rows land in the unified RAG store under the memory sentinel commit');

  // ---- retrieveMemory surfaces a relevant prior learning -----------------------------------------
  const hits = await retrieveMemory(prisma, wsId, 'Redis session store token expiry', 4);
  assert(hits.length >= 1, 'retrieveMemory returns a relevant prior learning');
  assert(hits.some((h) => h.content.includes('Redis')), 'the retrieved learning is the Redis session decision');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/institutionalMemory.test.mts');
