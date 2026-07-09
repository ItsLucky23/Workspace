//? W1 integration — the multi-question answer flow through the REAL Conductor + Mongo. A ticket parked with a
//? 3-question set is answered one at a time: the banner ADVANCES per answer and the ticket stays parked until
//? the LAST question is answered, at which point the set clears (and the parked turn would resume — no-op here
//? without a branch/Docker). Also verifies a BATCH answer clears every question at once. Cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function pollTicket(wsId: string, key: string, pred: (t: { needsInput: string | null; status: string; needsInputQuestions: unknown }) => boolean): Promise<{ needsInput: string | null; status: string; needsInputQuestions: unknown } | null> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const t = await prisma.ticket.findFirst({ where: { workspaceId: wsId, key }, select: { needsInput: true, status: true, needsInputQuestions: true } });
    if (t && pred(t)) return t;
    if (Date.now() >= deadline) return t;
    await wait(60);
  }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `mq-${String(stamp)}@youcomm.nl`, name: 'MQ' } });
let workspaceId: string | null = null;
const APPROVE_Q = '@@wsq:{"kind":"approve","prompt":"Deploy?"}';

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'MQ WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const projectId = project?.id ?? '';

  //? A parked ticket with a 3-question set (a free, an approve envelope, a free). No branch → the resume on the
  //? final answer no-ops cleanly.
  await prisma.ticket.create({ data: { workspaceId: wsId, projectId, key: 'MQ-1', number: 1, title: 'Stepper', stageId: 'implement', status: 'needs-input', labels: [], needsInput: 'What DB?', needsInputQuestions: [{ q: 'What DB?', a: null }, { q: APPROVE_Q, a: null }, { q: 'Region?', a: null }] } });

  // step 1: answer the first → banner advances to the approve question, still parked.
  await enqueueControlAction({ workspaceId: wsId, op: 'answer-input', target: { ticketKey: 'MQ-1' }, payload: { answer: 'Postgres' }, userId: owner.id, clientRequestId: `mq-a1-${String(stamp)}` });
  const s1 = await pollTicket(wsId, 'MQ-1', (t) => t.needsInput === APPROVE_Q);
  eq(s1?.needsInput, APPROVE_Q, 'banner advanced to the 2nd (approve) question');
  eq(s1?.status, 'needs-input', 'the ticket stays parked while questions remain');
  const set1 = s1?.needsInputQuestions as { q: string; a: string | null }[];
  eq(set1[0].a, 'Postgres', 'the first answer is stored');
  eq(set1[1].a, null, 'the 2nd question is still open');

  // step 2: answer the approve → banner advances to the 3rd.
  await enqueueControlAction({ workspaceId: wsId, op: 'answer-input', target: { ticketKey: 'MQ-1' }, payload: { answer: 'yes' }, userId: owner.id, clientRequestId: `mq-a2-${String(stamp)}` });
  const s2 = await pollTicket(wsId, 'MQ-1', (t) => t.needsInput === 'Region?');
  eq(s2?.needsInput, 'Region?', 'banner advanced to the 3rd question');
  eq(s2?.status, 'needs-input', 'still parked');

  // step 3: answer the last → the set clears (turn would resume; no-op without a branch).
  await enqueueControlAction({ workspaceId: wsId, op: 'answer-input', target: { ticketKey: 'MQ-1' }, payload: { answer: 'eu-west' }, userId: owner.id, clientRequestId: `mq-a3-${String(stamp)}` });
  const s3 = await pollTicket(wsId, 'MQ-1', (t) => t.needsInput === null);
  eq(s3?.needsInput, null, 'the banner clears once every question is answered');
  eq(s3?.needsInputQuestions, null, 'the question set is cleared');

  //? Audit: each answer was recorded as a comment note on the ticket.
  const [t1] = await prisma.ticket.findMany({ where: { workspaceId: wsId, key: 'MQ-1' } });
  const notes = await prisma.workspaceNote.findMany({ where: { workspaceId: wsId, ticketId: t1.id, authorKind: 'user' } });
  assert(notes.length >= 3, 'each of the 3 answers was recorded as an audit comment');

  // batch: a second ticket answered all-at-once.
  await prisma.ticket.create({ data: { workspaceId: wsId, projectId, key: 'MQ-2', number: 2, title: 'Batch', stageId: 'implement', status: 'needs-input', labels: [], needsInput: 'Q1', needsInputQuestions: [{ q: 'Q1', a: null }, { q: 'Q2', a: null }, { q: 'Q3', a: null }] } });
  await enqueueControlAction({ workspaceId: wsId, op: 'answer-input', target: { ticketKey: 'MQ-2' }, payload: { answers: ['one', 'two', 'three'] }, userId: owner.id, clientRequestId: `mq-b-${String(stamp)}` });
  const b = await pollTicket(wsId, 'MQ-2', (t) => t.needsInput === null);
  eq(b?.needsInput, null, 'a batch answer clears every question at once');
  eq(b?.needsInputQuestions, null, 'the batch clears the whole set');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/multiQuestion.test.mts');
