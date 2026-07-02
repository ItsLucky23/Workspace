//? Integration test for the [add-comment] control op (server/orchestrator/conductor.ts).
//? Runs against the REAL Conductor + Mongo: create a workspace, quick-add a ticket,
//? add a comment, and assert a `WorkspaceNote` (authorKind 'user') is persisted for
//? that ticket + an empty comment is rejected (no note written).

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
const owner = await prisma.user.create({ data: { email: `cmt-${String(stamp)}@youcomm.nl`, name: 'Comment Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Comment WS');
  workspaceId = created.workspaceId;

  await enqueueControlAction({ workspaceId, op: 'quick-add', target: {}, payload: { title: 'Comment me' }, userId: owner.id, clientRequestId: `c-${String(stamp)}` });
  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: workspaceId ?? '', title: 'Comment me' } }));
  assert(ticket !== null, 'quick-add created the ticket');
  const ticketDbId = ticket?.id ?? '';
  const ticketKey = ticket?.key ?? '';

  await enqueueControlAction({ workspaceId, op: 'add-comment', target: { ticketId: ticketKey }, payload: { body: 'Nice work on this one!' }, userId: owner.id, clientRequestId: `c2-${String(stamp)}` });
  const note = await poll(() => prisma.workspaceNote.findFirst({ where: { workspaceId: workspaceId ?? '', ticketId: ticketDbId } }));
  assert(note !== null, 'add-comment persists a WorkspaceNote for the ticket');
  eq(note?.body, 'Nice work on this one!', 'the comment body is stored');
  eq(note?.authorKind, 'user', "the comment is authored by kind 'user'");
  eq(note?.authorId, owner.id, 'the comment author is the caller');

  // an empty/whitespace comment must be rejected (no second note)
  await enqueueControlAction({ workspaceId, op: 'add-comment', target: { ticketId: ticketKey }, payload: { body: '   ' }, userId: owner.id, clientRequestId: `c3-${String(stamp)}` });
  await wait(600);
  const count = await prisma.workspaceNote.count({ where: { workspaceId: workspaceId ?? '', ticketId: ticketDbId } });
  eq(count, 1, 'an empty comment is ignored (still exactly one note)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/addComment.test.mts');
