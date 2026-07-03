//? Integration test for the needs-input answer flow (#17) against the REAL Conductor + Mongo. A
//? human answering the AI's open question must: record the answer as a comment, CLEAR the
//? needs-input banner, set the ticket back to idle, and trigger a re-fire (the re-fire itself needs
//? Docker; here we assert the authoritative DB effects the Conductor makes). Invalid/empty answers
//? are rejected (no state change).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ans-${String(stamp)}@youcomm.nl`, name: 'Answer Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Answer WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const aiStage = await prisma.pipelineStage.findFirst({ where: { workspaceId: wsId, aiEnabled: true } });
  const stageId = aiStage?.key ?? 'unrefined';

  //? A ticket parked at needs-input with a real open question + a branch (activated).
  const ticket = await prisma.ticket.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', key: 'DEV-7700', number: 7700, title: 'Ask me', stageId, status: 'needs-input', labels: [], branch: 'DEV-7700', needsInput: 'Which database should I use?', priority: 'normal' } });

  //? Empty answer → rejected, nothing changes.
  await enqueueControlAction({ workspaceId: wsId, op: 'answer-input', target: { ticketKey: 'DEV-7700' }, payload: { answer: '   ' }, userId: owner.id, clientRequestId: `ans-empty-${String(stamp)}` });
  await wait(400);
  eq((await prisma.ticket.findUnique({ where: { id: ticket.id } }))?.needsInput ?? '', 'Which database should I use?', 'an empty answer is rejected — the banner stays');

  //? A real answer → banner cleared, status idle, answer recorded as a comment.
  await enqueueControlAction({ workspaceId: wsId, op: 'answer-input', target: { ticketKey: 'DEV-7700' }, payload: { answer: 'Use PostgreSQL.' }, userId: owner.id, clientRequestId: `ans-real-${String(stamp)}` });
  const cleared = await poll(async () => {
    const t = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    return t && t.needsInput === null ? t : null;
  });
  assert(cleared !== null, 'answering clears the needs-input banner');
  eq(cleared?.status ?? '', 'idle', 'the ticket returns to idle so the re-fired turn can run');
  const note = await prisma.workspaceNote.findFirst({ where: { workspaceId: wsId, ticketId: ticket.id, authorKind: 'user' } });
  assert(note !== null && note.body.includes('Use PostgreSQL.'), 'the answer is recorded as a user comment (audit trail)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/answerInput.test.mts');
