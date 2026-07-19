//? Watchdog cron-sweep regressions: healthy renewable owner is untouched, expired owner is
//? offered for boot recovery, only hard turn-max may revoke a live owner, stale/done cleanup
//? does not reprovision, and dropped provisioning is deduped through the injected engine seam.

process.env.WS_CAPACITY_LEASE_MS = '30000';
process.env.WS_TURN_MAX_MS = '100000';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const watchdog = await import('../../server/orchestrator/watchdog');
const capacity = await import('../../server/orchestrator/capacity');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { EDITOR_DEFER_MSG, CAPACITY_DEFER_MSG } = await import('../../server/orchestrator/conductor');
const { enqueueInternalAction } = await import('../../server/orchestrator/internalOps');
const { needsInputHash, readRecoveryTransitionResult } = await import('../../server/orchestrator/recoveryWriter');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `wd-${String(stamp)}@youcomm.nl`, name: 'WD Owner' } });
let workspaceId = '';
const reservations: Awaited<ReturnType<typeof capacity.acquireSlot>>[] = [];

try {
  eq(watchdog.classifyBusySession({ wsPaused: false, ticketPaused: false, ticketDone: false, stageAiEnabled: true, realNeedsInput: false, hasContainer: true }), 'resume', 'live running stage classifies for resume');
  eq(watchdog.classifyBusySession({ wsPaused: false, ticketPaused: false, ticketDone: true, stageAiEnabled: true, realNeedsInput: false, hasContainer: true }), 'stop', 'done ticket classifies for cleanup only');
  eq(watchdog.classifyBusySession({ wsPaused: true, ticketPaused: false, ticketDone: false, stageAiEnabled: true, realNeedsInput: false, hasContainer: true }), 'skip', 'paused workspace is skipped');
  eq(watchdog.isRealNeedsInput(EDITOR_DEFER_MSG), false, 'editor defer is not a human question');
  eq(watchdog.isRealNeedsInput(CAPACITY_DEFER_MSG), false, 'capacity defer is not a human question');
  eq(watchdog.isRealNeedsInput('Which database?'), true, 'real question remains parked');

  const created = await createBlankWorkspace(prisma, owner.id, 'Watchdog recovery');
  workspaceId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
  const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: project?.id ?? '', aiEnabled: true, gateForApproval: false } });
  assert(project !== null && stage !== null, 'workspace has a project and runnable AI stage');
  if (!project || !stage) throw new Error('watchdog fixture failed');

  let number = 9000;
  const makeRun = async (suffix: string, acquireAt: number, startedAt: number, ticketStatus = 'busy') => {
    number += 1;
    const key = `DEV-${String(number)}`;
    const ticket = await prisma.ticket.create({ data: { workspaceId, projectId: project.id, key, number, title: suffix, stageId: stage.key, status: ticketStatus, archived: false, branch: key, labels: [], priority: 'normal' } });
    const acquired = await capacity.acquireSlot(key, workspaceId, false, acquireAt);
    assert(acquired.acquired, `${suffix} gets its initial capacity owner`);
    if (!acquired.acquired) throw new Error('capacity fixture failed');
    reservations.push(acquired);
    const session = await prisma.agentSession.create({
      data: {
        workspaceId,
        ticketId: ticket.id,
        stageId: stage.key,
        kind: 'worker',
        sessionKey: `worker:${ticket.id}:${stage.key}`,
        status: 'busy',
        containerId: `${suffix}-container`,
        runToken: acquired.reservation.runToken,
        runFence: acquired.reservation.fence,
        startedAt: new Date(startedAt),
      },
    });
    return { ticket, session, reservation: acquired.reservation };
  };

  const now = Date.now();
  const healthy = await makeRun('healthy', now, now);
  const recovered: { sessionId: string; reason: string; provision: boolean }[] = [];
  const healthySweep = await watchdog.runWatchdogSweep(now + 1000, {
    workspaceIds: [workspaceId],
    recover: async (input) => { recovered.push({ sessionId: input.sessionId, reason: input.reason, provision: input.provision }); return true; },
    reprovision: async () => undefined,
    pushReminder: async () => false,
  });
  eq(recovered.length, 0, 'healthy renewing owner is not boot-recovered or stolen');
  eq(healthySweep.recovered, 0, 'healthy sweep reports no recovery');
  eq((await prisma.agentSession.findUnique({ where: { id: healthy.session.id } }))?.status, 'busy', 'healthy session remains busy');
  await capacity.releaseSlot(healthy.reservation);

  const expiredAt = 1_000_000;
  const expired = await makeRun('expired', expiredAt, now);
  const expiredSweep = await watchdog.runWatchdogSweep(expiredAt + 30_001, {
    workspaceIds: [workspaceId],
    recover: async (input) => { recovered.push({ sessionId: input.sessionId, reason: input.reason, provision: input.provision }); return true; },
    reprovision: async () => undefined,
    pushReminder: async () => false,
  });
  assert(recovered.some((entry) => entry.sessionId === expired.session.id && entry.reason === 'boot'), 'expired owner is offered to boot recovery');
  assert(expiredSweep.recovered >= 1, 'expired recovery is counted');

  const prepareRequestId = `agent-recovery-prepare:boot:${expired.session.id}:${expired.reservation.runToken}:${String(expired.reservation.fence)}:${String(expired.session.startedAt.getTime())}`;
  const prepare = {
    workspaceId,
    op: 'agent-recovery-transition' as const,
    target: { ticketId: expired.ticket.id, ticketKey: expired.ticket.key, projectId: project.id, stageId: stage.key, sessionId: expired.session.id },
    payload: {
      phase: 'prepare' as const,
      reason: 'boot' as const,
      expected: {
        ticketStatus: expired.ticket.status,
        needsInputHash: needsInputHash(expired.ticket.needsInput),
        sessionStatus: 'busy' as const,
        containerId: expired.session.containerId ?? '',
        runToken: expired.reservation.runToken,
        runFence: expired.reservation.fence,
        startedAt: expired.session.startedAt.getTime(),
      },
      observedAt: expiredAt + 30_001,
    },
    userId: 'watchdog-test',
    clientRequestId: prepareRequestId,
  };
  const prepared = await enqueueInternalAction(prepare);
  const preparedResult = readRecoveryTransitionResult(prepared.result);
  assert(preparedResult?.applied === true && preparedResult.phase === 'prepare', 'crash fixture has an accepted durable prepare');
  recovered.length = 0;
  await watchdog.runWatchdogSweep(now + 40_000, {
    workspaceIds: [workspaceId],
    recover: async (input) => { recovered.push({ sessionId: input.sessionId, reason: input.reason, provision: input.provision }); return false; },
    reprovision: async () => undefined,
    pushReminder: async () => false,
  });
  assert(recovered.some((entry) => entry.sessionId === expired.session.id && entry.reason === 'boot'), 'cron reconstructs and continues a recovering prepare after process crash');

  if (!preparedResult?.applied || preparedResult.phase !== 'prepare') throw new Error('watchdog prepare fixture failed');
  await enqueueInternalAction({
    workspaceId,
    op: 'agent-recovery-transition',
    target: prepare.target,
    payload: {
      phase: 'complete',
      reason: 'boot',
      expected: prepare.payload.expected,
      intentId: preparedResult.intentId,
    },
    userId: 'watchdog-test',
    clientRequestId: `watchdog-complete-${preparedResult.intentId}`,
  });
  recovered.length = 0;
  await watchdog.runWatchdogSweep(now + 50_000, {
    workspaceIds: [workspaceId],
    recover: async (input) => { recovered.push({ sessionId: input.sessionId, reason: input.reason, provision: input.provision }); return false; },
    reprovision: async () => undefined,
    pushReminder: async () => false,
  });
  assert(recovered.some((entry) => entry.sessionId === expired.session.id && entry.provision), 'stopped recovery without a successor remains a cron-visible provisioning retry');

  const stuck = await makeRun('stuck', now, now - 100_001);
  recovered.length = 0;
  const stuckSweep = await watchdog.runWatchdogSweep(now, {
    workspaceIds: [workspaceId],
    recover: async (input) => { recovered.push({ sessionId: input.sessionId, reason: input.reason, provision: input.provision }); return true; },
    reprovision: async () => undefined,
    pushReminder: async () => false,
  });
  assert(recovered.some((entry) => entry.sessionId === stuck.session.id && entry.reason === 'stuck' && entry.provision), 'only hard turn-max routes a live owner to stuck recovery + reprovision');
  assert(stuckSweep.stuck >= 1, 'hard-stuck intervention is counted');

  const done = await makeRun('done', now, now, 'done');
  await capacity.releaseSlot(done.reservation);
  recovered.length = 0;
  await watchdog.runWatchdogSweep(now + 31_000, {
    workspaceIds: [workspaceId],
    recover: async (input) => { recovered.push({ sessionId: input.sessionId, reason: input.reason, provision: input.provision }); return true; },
    reprovision: async () => undefined,
    pushReminder: async () => false,
  });
  assert(recovered.some((entry) => entry.sessionId === done.session.id && !entry.provision), 'done/stale session cleanup never starts a successor');

  const idle = await prisma.ticket.create({ data: { workspaceId, projectId: project.id, key: 'DEV-9999', number: 9999, title: 'dropped', stageId: stage.key, status: 'idle', archived: false, branch: 'DEV-9999', labels: [], priority: 'normal' } });
  const reprovisioned: string[] = [];
  const idleSweep = await watchdog.runWatchdogSweep(now, {
    workspaceIds: [workspaceId],
    recover: async () => false,
    reprovision: async (_ws, key) => { reprovisioned.push(key); },
    pushReminder: async () => false,
  });
  eq(reprovisioned, [idle.key], 'a never-run activated stage reaches the engine reprovision seam once');
  eq(idleSweep.idle, 1, 'dropped provisioning is counted once');
} catch (error) {
  assert(false, `unexpected error during watchdog run: ${String(error)}`);
} finally {
  for (const result of reservations) if (result.acquired) await capacity.releaseSlot(result.reservation);
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/watchdog.test.mts');
