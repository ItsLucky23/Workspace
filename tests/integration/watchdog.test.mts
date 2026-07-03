//? Integration test for the crash-recovery watchdog (#1) against the REAL Prisma. Covers the pure
//? decision matrix (classifyBusySession / isRealNeedsInput), the boot reconciliation
//? (resumeEngineOnBoot with an injected container-lister — no Docker), and stuck-turn detection in a
//? sweep. Re-fires themselves need Docker; here we assert the OBSERVABLE state transitions the
//? watchdog makes (a stale busy session → stopped, a live-container interrupt → left busy to resume,
//? a done ticket's session → stopped, a parked turn → untouched, a hung turn → killed/stopped).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const wd = await import('../../server/orchestrator/watchdog');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { EDITOR_DEFER_MSG, CAPACITY_DEFER_MSG } = await import('../../server/orchestrator/conductor');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `wd-${String(stamp)}@youcomm.nl`, name: 'WD Owner' } });
let workspaceId: string | null = null;

//? Create a busy worker session for a ticket, optionally aged (startedAt in the past).
async function busySession(wsId: string, ticketId: string, stageId: string, key: string, agedMs = 0): Promise<string> {
  const s = await prisma.agentSession.create({
    data: { workspaceId: wsId, ticketId, stageId, kind: 'worker', sessionKey: `worker:${ticketId}:${stageId}:${key}`, status: 'busy', claudeSessionId: `cs-${key}`, startedAt: new Date(Date.now() - agedMs) },
  });
  return s.id;
}
const statusOf = async (id: string): Promise<string> => (await prisma.agentSession.findUnique({ where: { id } }))?.status ?? '';

try {
  // ---- pure decision matrix (no DB) ----
  eq(wd.classifyBusySession({ wsPaused: false, ticketPaused: false, ticketDone: false, stageAiEnabled: true, realNeedsInput: false, hasContainer: true }), 'resume', 'live container + running stage → resume');
  eq(wd.classifyBusySession({ wsPaused: false, ticketPaused: false, ticketDone: false, stageAiEnabled: true, realNeedsInput: false, hasContainer: false }), 'reprovision', 'dead container → reprovision fresh');
  eq(wd.classifyBusySession({ wsPaused: false, ticketPaused: false, ticketDone: true, stageAiEnabled: true, realNeedsInput: false, hasContainer: true }), 'stop', 'done ticket → stop the stale session');
  eq(wd.classifyBusySession({ wsPaused: false, ticketPaused: false, ticketDone: false, stageAiEnabled: false, realNeedsInput: false, hasContainer: true }), 'stop', 'non-AI stage → stop');
  eq(wd.classifyBusySession({ wsPaused: true, ticketPaused: false, ticketDone: false, stageAiEnabled: true, realNeedsInput: false, hasContainer: true }), 'skip', 'workspace paused → skip');
  eq(wd.classifyBusySession({ wsPaused: false, ticketPaused: true, ticketDone: false, stageAiEnabled: true, realNeedsInput: false, hasContainer: true }), 'skip', 'ticket paused → skip');
  eq(wd.classifyBusySession({ wsPaused: false, ticketPaused: false, ticketDone: false, stageAiEnabled: true, realNeedsInput: true, hasContainer: true }), 'skip', 'real human question → skip');

  eq(wd.isRealNeedsInput(null), false, 'no banner → not a real question');
  eq(wd.isRealNeedsInput(EDITOR_DEFER_MSG), false, 'editor defer banner → not a real question');
  eq(wd.isRealNeedsInput(CAPACITY_DEFER_MSG), false, 'capacity defer banner → not a real question');
  eq(wd.isRealNeedsInput('Which database should I use?'), true, 'a real question → parked');

  // ---- boot reconciliation with an injected container set ----
  const created = await createBlankWorkspace(prisma, owner.id, 'WD WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const aiStage = await prisma.pipelineStage.findFirst({ where: { workspaceId: wsId, aiEnabled: true, gateForApproval: false } });
  assert(aiStage !== null, 'the seeded workspace has an AI-enabled non-gate stage to test on');
  const stageId = aiStage?.key ?? '';

  const mk = async (n: number, patch: Record<string, unknown>): Promise<{ id: string; key: string; sid: string }> => {
    const key = `DEV-${String(8000 + n)}`;
    const t = await prisma.ticket.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', key, number: 8000 + n, title: `WD ${String(n)}`, stageId, status: 'idle', labels: [], branch: key, priority: 'normal', ...patch } });
    const sid = await busySession(wsId, t.id, stageId, key);
    return { id: t.id, key, sid };
  };

  const alive = await mk(1, {});                                   // container alive → resume (stays busy)
  const dead = await mk(2, {});                                    // container gone → reprovision (stopped)
  const done = await mk(3, { status: 'done' });                   // done → stop
  const paused = await mk(4, { status: 'paused' });               // paused → skip (stays busy)
  const asking = await mk(5, { needsInput: 'Which DB?' });        // real question → skip (stays busy)

  //? Inject: only `alive`'s container survived a crash.
  await wd.resumeEngineOnBoot({ listContainers: async () => new Set([alive.key]) });

  eq(await statusOf(alive.sid), 'busy', 'a live-container interrupt is left busy (resumed in place)');
  eq(await statusOf(dead.sid), 'stopped', 'a dead-container interrupt is stopped (then reprovisioned fresh)');
  eq(await statusOf(done.sid), 'stopped', "a done ticket's stale session is stopped");
  eq(await statusOf(paused.sid), 'busy', 'a paused ticket is left parked (untouched)');
  eq(await statusOf(asking.sid), 'busy', 'a ticket waiting on a human question is left parked');

  // ---- stuck-turn detection in a sweep ----
  const stuckTicket = await prisma.ticket.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', key: 'DEV-8100', number: 8100, title: 'stuck', stageId, status: 'busy', labels: [], branch: 'DEV-8100', priority: 'normal' } });
  const freshTicket = await prisma.ticket.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', key: 'DEV-8101', number: 8101, title: 'fresh', stageId, status: 'busy', labels: [], branch: 'DEV-8101', priority: 'normal' } });
  const stuckSid = await busySession(wsId, stuckTicket.id, stageId, 'stuck', 60 * 60 * 1000); // 1h old
  const freshSid = await busySession(wsId, freshTicket.id, stageId, 'fresh', 0);              // brand new, other ticket

  //? A clean IDLE candidate: activated, AI-enabled non-gate stage, status idle, NO session ever ran
  //? on this stage → the sweep should flag it for re-provision (a dropped provisioning turn).
  const idleTicket = await prisma.ticket.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', key: 'DEV-8102', number: 8102, title: 'idle', stageId, status: 'idle', labels: [], branch: 'DEV-8102', priority: 'normal' } });

  const sweep = await wd.runWatchdogSweep(Date.now());
  eq(await statusOf(stuckSid), 'stopped', 'a hung turn older than the turn-max is killed (session stopped)');
  eq(await statusOf(freshSid), 'busy', 'a fresh turn is NOT treated as stuck');
  assert(sweep.stuck >= 1, 'the sweep reports the stuck intervention');
  assert(sweep.idle >= 1, 'the sweep flags an activated no-session idle ticket for re-provision');

  //? Give the idle ticket a session for its current stage → a re-sweep must NOT re-fire it (its turn
  //? already ran; only NEVER-run stages are idle). The idle count drops by exactly one.
  await prisma.agentSession.create({ data: { workspaceId: wsId, ticketId: idleTicket.id, stageId, kind: 'worker', sessionKey: `worker:${idleTicket.id}:${stageId}`, status: 'stopped' } });
  const sweep2 = await wd.runWatchdogSweep(Date.now());
  eq(sweep2.idle, sweep.idle - 1, 'a stage that already produced a session is no longer flagged idle');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/watchdog.test.mts');
