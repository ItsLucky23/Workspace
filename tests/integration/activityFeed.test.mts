//? Integration test for the Activity-feed producer (server/orchestrator/conductor.ts
//? `recordTicketEvent`): ticket-affecting control ops must append an append-only
//? `TicketEvent` so the Activity feed / ticket timeline is real (not seed-replay).
//? Runs against the REAL Conductor + Mongo. Asserts quick-add + bulk-move each append
//? an event, the actor is the caller, and `seq` increments monotonically per ticket.

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
const owner = await prisma.user.create({ data: { email: `feed-${String(stamp)}@youcomm.nl`, name: 'Feed Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Activity WS');
  workspaceId = created.workspaceId;

  // quick-add → expect one TicketEvent
  await enqueueControlAction({ workspaceId, op: 'quick-add', target: {}, payload: { title: 'Feed Ticket' }, userId: owner.id, clientRequestId: `fa-${String(stamp)}` });
  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: workspaceId ?? '', title: 'Feed Ticket' } }));
  assert(ticket !== null, 'quick-add created the ticket');
  const ticketId = ticket?.id ?? '';

  const firstEvent = await poll(() => prisma.ticketEvent.findFirst({ where: { workspaceId: workspaceId ?? '', ticketId } }));
  assert(firstEvent !== null, 'quick-add appended a TicketEvent (activity-feed producer)');
  eq(firstEvent?.actor, owner.id, 'the event actor is the caller');
  eq(firstEvent?.seq, 1, "the ticket's first event has seq 1");

  // bulk-move → expect a second TicketEvent with seq 2
  await enqueueControlAction({ workspaceId, op: 'bulk-move', target: { ticketIds: [ticket?.key ?? ''] }, payload: { stageId: 'impl' }, userId: owner.id, clientRequestId: `fa2-${String(stamp)}` });
  const count = await poll(async () => {
    const c = await prisma.ticketEvent.count({ where: { workspaceId: workspaceId ?? '', ticketId } });
    return c >= 2 ? c : null;
  });
  eq(count, 2, 'bulk-move appended a second TicketEvent (seq increments per ticket)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/activityFeed.test.mts');
