//? Integration test for O-D (IDEA_TO_OUTCOME) — "start with AI" auto-activation. Real Conductor + Mongo. A
//? quick-add with startWithAi still ENTERS at 'unrefined' (invariant) but the Conductor then advances it to the
//? FIRST aiEnabled stage — no manual drag. Without startWithAi it stays at 'unrefined'. B-23: Conductor writes.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 10_000, stepMs = 80): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `aa-${String(stamp)}@youcomm.nl`, name: 'AA' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'AA WS' }, userId: owner.id, clientRequestId: `aa-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  const wsId = ws?.id ?? '';
  workspaceId = ws?.id ?? null;

  const firstAi = await prisma.pipelineStage.findFirst({ where: { workspaceId: wsId, aiEnabled: true }, orderBy: { order: 'asc' }, select: { key: true } });
  assert(firstAi !== null && firstAi.key !== 'unrefined', 'the workspace has a first aiEnabled stage that is not unrefined');

  //? 1) plain quick-add → stays at 'unrefined' (AI off).
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'Plain ticket' }, userId: owner.id, clientRequestId: `aa-plain-${String(stamp)}` });
  const plain = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'Plain ticket' } }));
  eq(plain?.stageId, 'unrefined', 'a plain quick-add enters at unrefined');

  //? 2) quick-add with startWithAi → advanced to the first aiEnabled stage.
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'AI ticket', startWithAi: true }, userId: owner.id, clientRequestId: `aa-ai-${String(stamp)}` });
  const aiTicket = await poll(async () => { const t = await prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'AI ticket' } }); return t && t.stageId !== 'unrefined' ? t : null; });
  assert(aiTicket !== null, 'the AI ticket left unrefined');
  eq(aiTicket?.stageId, firstAi?.key, 'startWithAi advances the ticket to the first aiEnabled stage');

  //? A status-change event records the auto-start (audit trail).
  const events = await prisma.ticketEvent.findMany({ where: { workspaceId: wsId, ticketId: aiTicket?.id ?? '' } });
  assert(events.some((e) => e.text.includes('auto-started AI')), 'the auto-start is recorded as a ticket event');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/autoActivate.test.mts');
