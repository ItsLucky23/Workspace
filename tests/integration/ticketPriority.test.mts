//? Integration test for ticket-priority + notification-preferences (#13), against the
//? REAL Conductor + Mongo. Covers: quick-add persists a valid priority (and defaults to
//? 'normal'); ticket-edit updates it; an INVALID priority is rejected (Conductor is the
//? single writer — a bad value never lands); and the assignment Notification respects the
//? recipient's User.preferences.notifyOnAssignment opt-out (default on).

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
const owner = await prisma.user.create({ data: { email: `prio-owner-${String(stamp)}@youcomm.nl`, name: 'Prio Owner' } });
const optOut = await prisma.user.create({ data: { email: `prio-optout-${String(stamp)}@youcomm.nl`, name: 'Opt Out', preferences: { notifyOnAssignment: false } } });
const optIn = await prisma.user.create({ data: { email: `prio-optin-${String(stamp)}@youcomm.nl`, name: 'Opt In' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Prio WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  await prisma.workspaceMember.create({ data: { workspaceId: wsId, userId: optOut.id, roleKey: 'member' } });
  await prisma.workspaceMember.create({ data: { workspaceId: wsId, userId: optIn.id, roleKey: 'member' } });

  //? quick-add with priority='urgent' → persisted verbatim.
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'Urgent one', priority: 'urgent' }, userId: owner.id, clientRequestId: `qa-urgent-${String(stamp)}` });
  const urgent = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'Urgent one' } }));
  assert(urgent !== null, 'quick-add created the urgent ticket');
  eq(urgent?.priority ?? '', 'urgent', 'quick-add persisted priority=urgent');

  //? quick-add without priority → defaults to 'normal'.
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'Default prio' }, userId: owner.id, clientRequestId: `qa-def-${String(stamp)}` });
  const def = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'Default prio' } }));
  eq(def?.priority ?? '', 'normal', 'quick-add defaults priority to normal');

  //? ticket-edit → change to 'high'.
  const key = def?.key ?? '';
  await enqueueControlAction({ workspaceId: wsId, op: 'ticket-edit', target: { ticketId: key }, payload: { priority: 'high' }, userId: owner.id, clientRequestId: `te-high-${String(stamp)}` });
  const high = await poll(async () => {
    const t = await prisma.ticket.findFirst({ where: { workspaceId: wsId, key } });
    return t?.priority === 'high' ? t : null;
  });
  assert(high !== null, 'ticket-edit updated priority to high');

  //? ticket-edit with an INVALID priority → rejected (stays 'high').
  await enqueueControlAction({ workspaceId: wsId, op: 'ticket-edit', target: { ticketId: key }, payload: { priority: 'bogus' }, userId: owner.id, clientRequestId: `te-bad-${String(stamp)}` });
  await wait(500);
  const afterBad = await prisma.ticket.findFirst({ where: { workspaceId: wsId, key } });
  eq(afterBad?.priority ?? '', 'high', 'an invalid priority is rejected — the previous value stands');

  //? Notification-preferences: assigning to the opt-OUT member emits NO notification.
  await enqueueControlAction({ workspaceId: wsId, op: 'bulk-assign', target: { ticketIds: [key] }, payload: { assigneeId: optOut.id }, userId: owner.id, clientRequestId: `asg-out-${String(stamp)}` });
  await wait(600);
  const outCount = await prisma.notification.count({ where: { workspaceId: wsId, userId: optOut.id, type: 'assignment' } });
  eq(outCount, 0, 'a member who opted out of assignment notifications gets none');

  //? Assigning to the opt-IN (default, unset pref) member DOES emit one.
  await enqueueControlAction({ workspaceId: wsId, op: 'bulk-assign', target: { ticketIds: [key] }, payload: { assigneeId: optIn.id }, userId: owner.id, clientRequestId: `asg-in-${String(stamp)}` });
  const inNotif = await poll(() => prisma.notification.findFirst({ where: { workspaceId: wsId, userId: optIn.id, type: 'assignment' } }));
  assert(inNotif !== null, 'a member with the default (unset) pref still gets the assignment notification');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id, optOut.id, optIn.id]).catch(() => undefined);
  else await Promise.all([owner, optOut, optIn].map((u) => prisma.user.delete({ where: { id: u.id } }).catch(() => undefined)));
}

report('tests/integration/ticketPriority.test.mts');
