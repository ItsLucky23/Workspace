//? Test for FREEDOM_PROGRAM A5 — stale needs-input re-ping. Verifies the pure shouldRemind gate and that the
//? watchdog sweep baselines a freshly-parked question (no immediate ping), re-pings the assignee once the
//? interval elapses (a notification for the assignee), doesn't double-ping within the window, and stops once
//? the question is answered (remindedAt cleared). Real sweep + Mongo; `now` injected for determinism.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const wd = await import('../../server/orchestrator/watchdog');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const REMIND_MS = 120 * 60_000; // matches the watchdog default

// pure gate
eq(wd.shouldRemind(null, 1000, REMIND_MS), false, 'never-seen → no ping (baseline first)');
eq(wd.shouldRemind(new Date(0), REMIND_MS - 1, REMIND_MS), false, 'within the window → no ping');
eq(wd.shouldRemind(new Date(0), REMIND_MS, REMIND_MS), true, 'at the window → ping');
eq(wd.shouldRemind(new Date(0), REMIND_MS + 5, REMIND_MS), true, 'past the window → ping');

const stamp = Date.now();
const assignee = await prisma.user.create({ data: { email: `nir-${String(stamp)}@youcomm.nl`, name: 'NIR' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, assignee.id, 'NIR WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId: wsId }, orderBy: { order: 'asc' } });
  const ticket = await prisma.ticket.create({ data: { workspaceId: wsId, projectId: wsId, number: 1, key: 'NIR-1', title: 'Q', stageId: stage?.key ?? 'plan', status: 'idle', needsInput: 'Which colour do you want?', assigneeId: assignee.id } });

  const T0 = 1_000_000_000;
  const notifCount = async (): Promise<number> => prisma.notification.count({ where: { workspaceId: wsId, userId: assignee.id, type: 'reminder' } });

  // first sweep → baseline, no ping
  const s1 = await wd.runWatchdogSweep(T0, { workspaceIds: [wsId] });
  eq(s1.reminded, 0, 'first sight → baseline, no re-ping');
  eq(await notifCount(), 0, 'no reminder notification yet');
  assert((await prisma.ticket.findUnique({ where: { id: ticket.id } }))?.remindedAt != null, 'baseline remindedAt was set');

  // within window → still no ping
  const s2 = await wd.runWatchdogSweep(T0 + REMIND_MS - 1, { workspaceIds: [wsId] });
  eq(s2.reminded, 0, 'within the window → no re-ping');

  // past window → two overlapping sweeps still produce one deterministic notification + one push claim.
  const dueAt = T0 + REMIND_MS + 1;
  const [s3a, s3b] = await Promise.all([
    wd.runWatchdogSweep(dueAt, { workspaceIds: [wsId] }),
    wd.runWatchdogSweep(dueAt, { workspaceIds: [wsId] }),
  ]);
  eq(s3a.reminded + s3b.reminded, 1, 'two due sweeps claim exactly one reminder push');
  eq(await notifCount(), 1, 'deterministic notification upsert creates one reminder row');
  eq((await prisma.ticket.findUnique({ where: { id: ticket.id } }))?.remindedAt?.getTime(), dueAt, 'the reminder timestamp advances exactly once to the due sweep time');

  // immediately again → within the fresh window, no double-ping
  const s4 = await wd.runWatchdogSweep(T0 + REMIND_MS + 2, { workspaceIds: [wsId] });
  eq(s4.reminded, 0, 'no double-ping within the fresh window');

  // answered → banner + remindedAt cleared → no more reminders
  await prisma.ticket.update({ where: { id: ticket.id }, data: { needsInput: null, remindedAt: null } });
  const s5 = await wd.runWatchdogSweep(T0 + 10 * REMIND_MS, { workspaceIds: [wsId] });
  eq(s5.reminded, 0, 'an answered question is never re-pinged');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [assignee.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: assignee.id } }).catch(() => undefined);
}

report('tests/integration/needsInputRemind.test.mts');
