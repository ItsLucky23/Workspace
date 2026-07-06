//? Integration test for G2 (review ergonomics, ADR 0048). Runs against the REAL Conductor + Mongo (+ the
//? snapshot builder). Asserts the cross-ticket ANSWER-QUEUE: a ticket parked on a question surfaces in one
//? queue (highest priority first), a ticket with no question does not, and the presence relay carries the
//? soft-CLAIM flag (who's answering). The claim itself is ephemeral (a relay) — asserted at the relay shape.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');
const presenceRoute = await import('../../src/workspaces/_sync/presence_server_v1');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

// ---- the presence relay carries the soft-claim (pure) ---------------------------------------------
const claimed = presenceRoute.main({ clientInput: { ticketKey: 'DEV-1', viewing: true, claiming: true, clientRequestId: 'x' }, user: { id: 'u1' } as never, functions: {} as never, roomCode: 'ws' });
assert(claimed.status === 'success' && claimed.status === 'success' && (claimed as { presence: { claiming: boolean } }).presence.claiming === true, 'the presence relay broadcasts a soft-claim (claiming:true)');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `aq-test-${String(stamp)}@youcomm.nl`, name: 'AQ Test' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'AQ Test WS' }, userId: owner.id, clientRequestId: `aq-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  //? A ticket parked on a question (needs-input) + a normal ticket.
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'Parked ticket', priority: 'high' }, userId: owner.id, clientRequestId: `aq-t1-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'Normal ticket' }, userId: owner.id, clientRequestId: `aq-t2-${String(stamp)}` });
  const parked = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'Parked ticket' } }));
  await prisma.ticket.updateMany({ where: { id: parked?.id ?? '' }, data: { status: 'needs-input', needsInput: 'Which auth provider should we use?' } });

  // ---- the answer-queue surfaces the parked ticket, not the normal one ---------------------------
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  assert(snap.answerQueue.some((q) => q.ticketKey === parked?.key), 'the parked (needs-input) ticket is in the answer-queue');
  assert(!snap.answerQueue.some((q) => q.title === 'Normal ticket'), 'a ticket with no question is NOT in the answer-queue');
  const item = snap.answerQueue.find((q) => q.ticketKey === parked?.key);
  eq(item?.question, 'Which auth provider should we use?', 'the queue item carries the pending question');
  eq(item?.priority, 'high', 'the queue item carries the ticket priority (for ordering)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/answerQueue.test.mts');
