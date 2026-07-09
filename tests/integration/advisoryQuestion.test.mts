//? W2 integration — resolving a NON-blocking advisory question via the REAL Conductor + Mongo. A ticket carries
//? advisory questions the agent proceeded past (with assumptions); answering one via `answer-input` + an
//? `advisoryIndex` marks it resolved (a matching answer = no revision), while a DIVERGENT answer marks it resolved
//? too but would fire a revision turn (no-op here without a branch/Docker). The ticket never parks on these
//? (status stays unchanged). Cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `adv-${String(stamp)}@youcomm.nl`, name: 'Adv' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Adv WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId } });

  //? A ticket the agent COMPLETED, leaving two non-blocking advisory questions (status 'idle' → NOT parked).
  await prisma.ticket.create({ data: {
    workspaceId: wsId, projectId: project?.id ?? '', key: 'ADV-1', number: 1, title: 'Advisory', stageId: 'implement', status: 'idle', labels: [],
    advisoryQuestions: [{ q: 'Which port?', assumption: '8080', a: null, resolved: false }, { q: 'Retry count?', assumption: '3', a: null, resolved: false }],
  } });

  // 1) a MATCHING answer resolves it, no divergence.
  await enqueueControlAction({ workspaceId: wsId, op: 'answer-input', target: { ticketKey: 'ADV-1' }, payload: { advisoryIndex: 0, answer: '8080' }, userId: owner.id, clientRequestId: `adv-0-${String(stamp)}` });
  const afterMatch = await poll(async () => {
    const t = await prisma.ticket.findFirst({ where: { workspaceId: wsId, key: 'ADV-1' }, select: { advisoryQuestions: true, status: true } });
    const list = t?.advisoryQuestions as { q: string; a: string | null; resolved: boolean }[] | null;
    return list && list[0].resolved ? { list, status: t?.status } : null;
  });
  assert(afterMatch !== null, 'the matching advisory was resolved');
  eq(afterMatch?.list[0].a, '8080', 'the matching answer is stored');
  eq(afterMatch?.list[0].resolved, true, 'advisory 0 is resolved');
  eq(afterMatch?.list[1].resolved, false, 'advisory 1 is still open');
  eq(afterMatch?.status, 'idle', 'the ticket never parked on the advisory (status unchanged)');

  // 2) a DIVERGENT answer resolves the 2nd + would fire a revision turn (no branch → no-op, state still updates).
  await enqueueControlAction({ workspaceId: wsId, op: 'answer-input', target: { ticketKey: 'ADV-1' }, payload: { advisoryIndex: 1, answer: '10' }, userId: owner.id, clientRequestId: `adv-1-${String(stamp)}` });
  const afterDiff = await poll(async () => {
    const t = await prisma.ticket.findFirst({ where: { workspaceId: wsId, key: 'ADV-1' }, select: { advisoryQuestions: true } });
    const list = t?.advisoryQuestions as { q: string; a: string | null; resolved: boolean }[] | null;
    return list && list[1].resolved ? list : null;
  });
  eq(afterDiff?.[1].a, '10', 'the divergent answer is stored');
  eq(afterDiff?.[1].resolved, true, 'advisory 1 is now resolved');

  //? Audit: each advisory answer was recorded as a comment.
  const [t1] = await prisma.ticket.findMany({ where: { workspaceId: wsId, key: 'ADV-1' } });
  const notes = await prisma.workspaceNote.findMany({ where: { workspaceId: wsId, ticketId: t1.id, authorKind: 'user' } });
  assert(notes.some((n) => n.body.includes('advisory')), 'the advisory answers are audit-logged as comments');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/advisoryQuestion.test.mts');
