//? Integration test for the Notification producer (server/orchestrator/conductor.ts
//? `notifyAssignment`): assigning a ticket to a member emits an 'assignment'
//? Notification for that member (so the in-app bell is real, not seed-only), and a
//? self-assignment does NOT notify. Runs against the REAL Conductor + Mongo.

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
const owner = await prisma.user.create({ data: { email: `notif-owner-${String(stamp)}@youcomm.nl`, name: 'Notif Owner' } });
const member = await prisma.user.create({ data: { email: `notif-member-${String(stamp)}@youcomm.nl`, name: 'Notif Member' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Notif WS');
  workspaceId = created.workspaceId;
  await prisma.workspaceMember.create({ data: { workspaceId, userId: member.id, roleKey: 'member' } });

  await enqueueControlAction({ workspaceId, op: 'quick-add', target: {}, payload: { title: 'Assign me' }, userId: owner.id, clientRequestId: `np-${String(stamp)}` });
  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: workspaceId ?? '', title: 'Assign me' } }));
  assert(ticket !== null, 'quick-add created the ticket');
  const ticketKey = ticket?.key ?? '';

  // owner assigns the ticket to the member → the member gets an 'assignment' notification
  await enqueueControlAction({ workspaceId, op: 'bulk-assign', target: { ticketIds: [ticketKey] }, payload: { assigneeId: member.id }, userId: owner.id, clientRequestId: `np2-${String(stamp)}` });
  const notif = await poll(() => prisma.notification.findFirst({ where: { workspaceId: workspaceId ?? '', userId: member.id, type: 'assignment' } }));
  assert(notif !== null, 'assigning a ticket emits an assignment Notification for the assignee');
  assert((notif?.body ?? '').includes(ticketKey), 'the notification body references the ticket key');

  // owner assigns to THEMSELVES → no self-notification
  await enqueueControlAction({ workspaceId, op: 'bulk-assign', target: { ticketIds: [ticketKey] }, payload: { assigneeId: owner.id }, userId: owner.id, clientRequestId: `np3-${String(stamp)}` });
  await wait(600); // let the async chain drain
  const ownerNotifs = await prisma.notification.count({ where: { workspaceId: workspaceId ?? '', userId: owner.id, type: 'assignment' } });
  eq(ownerNotifs, 0, 'a self-assignment does not notify the assigner');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id, member.id]).catch(() => undefined);
  else await Promise.all([owner, member].map((u) => prisma.user.delete({ where: { id: u.id } }).catch(() => undefined)));
}

report('tests/integration/notificationProducer.test.mts');
