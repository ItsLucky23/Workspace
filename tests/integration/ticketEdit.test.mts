//? Integration test for the [ticket-edit] control op (server/orchestrator/conductor.ts).
//? Runs against the REAL Conductor + Mongo: create a workspace, quick-add a ticket,
//? then edit its title + description, and assert the write persists — including that
//? an empty-string description CLEARS the field (the `'description' in payload` path).

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
const owner = await prisma.user.create({ data: { email: `edit-${String(stamp)}@youcomm.nl`, name: 'Edit Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Edit WS');
  workspaceId = created.workspaceId;

  await enqueueControlAction({ workspaceId, op: 'quick-add', target: {}, payload: { title: 'Original title' }, userId: owner.id, clientRequestId: `te-${String(stamp)}` });
  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: workspaceId ?? '', title: 'Original title' } }));
  assert(ticket !== null, 'quick-add created the ticket');
  const ticketDbId = ticket?.id ?? '';
  const ticketKey = ticket?.key ?? '';

  // edit title + description
  await enqueueControlAction({ workspaceId, op: 'ticket-edit', target: { ticketId: ticketKey }, payload: { title: 'Renamed title', description: 'A brand new description' }, userId: owner.id, clientRequestId: `te2-${String(stamp)}` });
  const edited = await poll(async () => {
    const t = await prisma.ticket.findFirst({ where: { workspaceId: workspaceId ?? '', id: ticketDbId } });
    return t?.title === 'Renamed title' ? t : null;
  });
  eq(edited?.title, 'Renamed title', 'ticket-edit updated the title');
  eq(edited?.description, 'A brand new description', 'ticket-edit updated the description');

  // clearing the description with an empty string must persist as ''
  await enqueueControlAction({ workspaceId, op: 'ticket-edit', target: { ticketId: ticketKey }, payload: { description: '' }, userId: owner.id, clientRequestId: `te3-${String(stamp)}` });
  const cleared = await poll(async () => {
    const t = await prisma.ticket.findFirst({ where: { workspaceId: workspaceId ?? '', id: ticketDbId } });
    return t?.description === '' ? t : null;
  });
  eq(cleared?.description, '', 'ticket-edit clears the description when given an empty string');
  eq(cleared?.title, 'Renamed title', 'clearing the description left the title untouched');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/ticketEdit.test.mts');
