//? End-to-end fenced recovery writer: durable prepare intent, exact Redis/session CAS,
//? external Docker seam outside writer, complete-before-awaited-provision, cancel on races/failure.

process.env.WS_MAX_CONCURRENT_TURNS = '20';
process.env.WS_CAPACITY_LEASE_MS = '30000';
process.env.WS_TURN_MAX_MS = '100000';

import { redis, tryCatch } from '@luckystack/core';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';
import type { WorkerContainerIdentity } from '../../server/container/runtime.ts';
import type { SlotReservation } from '../../server/orchestrator/capacity.ts';

const prisma = await db();
const capacity = await import('../../server/orchestrator/capacity');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { runAgentRecovery, recoverExactContainer } = await import('../../server/orchestrator/agentControl');
const { applyAgentRecoveryTransition, findAcceptedRecoveryPrepare, readRecoveryTransitionResult, recoveryIntentId, needsInputHash } = await import('../../server/orchestrator/recoveryWriter');
const { enqueueInternalAction } = await import('../../server/orchestrator/internalOps');
const { enqueueControlAction, isControlActionFailure, provisionContainers } = await import('../../server/orchestrator/conductor');
const { controlActionOutcomeKey } = await import('../../server/orchestrator/cluster');
const { runInTenant } = await import('../../server/tenant/tenantContext');
const { currentWriterScope, runInWriterContext } = await import('../../server/orchestrator/writerContext');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `recovery-${String(stamp)}@youcomm.nl`, name: 'Recovery owner' } });
let workspaceId = '';
const held: SlotReservation[] = [];

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Recovery writer');
  workspaceId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
  const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: project?.id ?? '', aiEnabled: true } });
  assert(project !== null && stage !== null, 'recovery fixture has project + AI stage');
  if (!project || !stage) throw new Error('recovery fixture failed');

  let number = 9500;
  const fixture = async (suffix: string, acquireAt: number, reason: 'boot' | 'manual-kill' = 'boot') => {
    number += 1;
    const key = `DEV-${String(number)}`;
    const ticket = await prisma.ticket.create({ data: { workspaceId, projectId: project.id, key, number, title: suffix, stageId: stage.key, status: 'busy', archived: false, branch: key, labels: [], priority: 'normal' } });
    const acquired = await capacity.acquireSlot(key, workspaceId, false, acquireAt);
    assert(acquired.acquired, `${suffix} old owner admitted`);
    if (!acquired.acquired) throw new Error('capacity fixture failed');
    held.push(acquired.reservation);
    const startedAt = new Date(Date.now() - 1000);
    const session = await prisma.agentSession.create({ data: {
      workspaceId,
      ticketId: ticket.id,
      stageId: stage.key,
      kind: 'worker',
      sessionKey: `worker:${ticket.id}:${stage.key}`,
      status: 'busy',
      containerId: `${suffix}-container-id`,
      runToken: acquired.reservation.runToken,
      runFence: acquired.reservation.fence,
      startedAt,
    } });
    const requestId = `agent-recovery-prepare:${reason}:${session.id}:${acquired.reservation.runToken}:${String(acquired.reservation.fence)}:${String(startedAt.getTime())}`;
    return {
      ticket,
      session,
      old: acquired.reservation,
      requestId,
      prepare: {
        workspaceId,
        op: 'agent-recovery-transition' as const,
        target: { ticketId: ticket.id, ticketKey: key, projectId: project.id, stageId: stage.key, sessionId: session.id },
        payload: {
          phase: 'prepare' as const,
          reason,
          expected: {
            ticketStatus: ticket.status,
            needsInputHash: needsInputHash(ticket.needsInput),
            sessionStatus: 'busy' as const,
            containerId: `${suffix}-container-id`,
            runToken: acquired.reservation.runToken,
            runFence: acquired.reservation.fence,
            startedAt: startedAt.getTime(),
          },
          observedAt: acquireAt + 30_001,
        },
        userId: 'recovery-test',
        clientRequestId: requestId,
      },
    };
  };

  const maintain: typeof capacity.withReservationRenewal = async (_reservation, fn) => fn({
    signal: new AbortController().signal,
    assertOwned: async () => undefined,
  });

  // Crash after prepare: terminal replay has only keys, but the durable processed signal
  // reconstructs the rich owner and recovery continues to one proven higher-fence successor.
  const success = await fixture('success', Date.now() - 30_001);
  const preparedBeforeCrash = await enqueueInternalAction(success.prepare);
  assert(readRecoveryTransitionResult(preparedBeforeCrash.result)?.applied === true, 'prepare is durably accepted before the simulated crash');
  eq((await prisma.agentSession.findUnique({ where: { id: success.session.id } }))?.status, 'recovering', 'prepare leaves the old session in recovering');
  // Simulate process death after the session mutation but before Conductor marks the deterministic
  // signal processed. Recovery must trust only the exact signal+session+reservation identity.
  const crashIntentId = recoveryIntentId(workspaceId, success.requestId);
  await prisma.workspaceSignal.update({ where: { id: crashIntentId }, data: { processedAt: null } });
  const crashReconstruction = await findAcceptedRecoveryPrepare(prisma, workspaceId, {
    id: success.session.id,
    ticketId: success.ticket.id,
    stageId: success.session.stageId,
    status: 'recovering',
    containerId: success.session.containerId ?? '',
    runToken: success.session.runToken ?? '',
    runFence: success.session.runFence,
    startedAt: success.session.startedAt.getTime(),
  });
  assert(crashReconstruction?.state === 'recovering', 'an unprocessed durable prepare reconstructs after the exact session mutation crash window');
  const replayedPrepare = await enqueueInternalAction(success.prepare);
  eq(replayedPrepare.result, { keys: [success.ticket.key] }, 'terminal dedup replay intentionally carries only bounded keys');

  const order: string[] = [];
  let provisions = 0;
  let successorReservation: SlotReservation | null = null;
  const recovered = await runAgentRecovery({
    prepare: success.prepare,
    mode: 'kill-claude',
    provision: async () => {
      eq(currentWriterScope(), null, 'provision runs after complete and outside workspace writer');
      eq((await prisma.agentSession.findUnique({ where: { id: success.session.id } }))?.status, 'stopped', 'complete releases Redis before marking the exact old session stopped');
      provisions += 1;
      order.push('provision');
      const successor = await capacity.acquireSlot(success.ticket.key, workspaceId, false, Date.now());
      if (!successor.acquired) return false;
      successorReservation = successor.reservation;
      held.push(successor.reservation);
      await prisma.agentSession.update({
        where: { id: success.session.id },
        data: { status: 'busy', runToken: successor.reservation.runToken, runFence: successor.reservation.fence },
      });
      return true;
    },
  }, {
    claimExternal: async () => true,
    maintain,
    recover: async (expected) => {
      eq(currentWriterScope(), null, 'Docker recovery runs outside workspace writer');
      eq(expected.containerId, success.session.containerId, 'external phase receives immutable exact container id');
      order.push('docker');
      return { ok: true, container: { workspaceId, projectId: project.id, ticketKey: success.ticket.key, containerId: expected.containerId, name: 'success-container' } };
    },
  });
  assert(recovered.recovered, 'expired owner completes fenced recovery only after successor proof');
  eq(order, ['docker', 'provision'], 'external kill completes before awaited reprovision');
  eq(provisions, 1, 'stuck/boot recovery provisions a successor exactly once');
  assert(successorReservation?.fence === success.old.fence + 2, 'old → recovery → successor advances one fence per accepted owner exactly once');
  const intentId = recoveryIntentId(workspaceId, success.requestId);
  const intent = await prisma.workspaceSignal.findUnique({ where: { id: intentId }, select: { processedAt: true, payload: true } });
  assert(intent !== null && JSON.stringify(intent.payload).includes(success.old.runToken), 'prepare intent remains durable and binds the old owner even when its processed marker was lost');
  eq(intent?.processedAt, null, 'the recovery path did not rely on repairing the simulated missing processed marker');
  eq(await capacity.reservationOwnsSlot(workspaceId, success.ticket.key, success.old.runToken, success.old.fence, success.prepare.payload.observedAt), false, 'prepare immediately revoked old stage write authority');

  // Simulate the Redis terminal-outcome TTL expiring. The deterministic Mongo signal is
  // reused instead of colliding on create, even though the old run is now stale.
  await redis.del(controlActionOutcomeKey(`internal:${workspaceId}:${success.requestId}`));
  await enqueueInternalAction(success.prepare);
  eq(await prisma.workspaceSignal.count({ where: { id: intentId } }), 1, 'post-TTL retry reuses the exact deterministic prepare signal');

  // Docker failure: cancel restores session state, does not complete/provision, and rolls back provisional fence.
  const failed = await fixture('docker-fail', Date.now() - 30_001);
  let failedProvision = 0;
  const failedRun = await runAgentRecovery({
    prepare: failed.prepare,
    mode: 'kill-claude',
    provision: async () => { failedProvision += 1; return true; },
  }, {
    claimExternal: async () => true,
    maintain,
    recover: async () => ({ ok: false, reason: 'docker' }),
  });
  eq(failedRun, { recovered: false, reason: 'docker' }, 'nonzero Docker outcome cancels recovery');
  eq(failedProvision, 0, 'Docker failure never reprovisions');
  eq((await prisma.agentSession.findUnique({ where: { id: failed.session.id } }))?.status, 'busy', 'cancel restores exact prior session status');
  const retry = await capacity.acquireSlot(failed.ticket.key, workspaceId, false, failed.prepare.payload.observedAt + 1);
  assert(retry.acquired, 'cancel releases recovery claim for a safe later retry');
  if (retry.acquired) {
    eq(retry.reservation.fence, failed.old.fence + 1, 'cancel rolls back only its provisional fence before successor admission');
    held.push(retry.reservation);
  }

  // Status/editor race after prepare: no Docker call, cancel restores session, no complete/provision.
  const raced = await fixture('race', Date.now() - 30_001);
  let dockerCalls = 0;
  let raceProvisions = 0;
  const racedRun = await runAgentRecovery({
    prepare: raced.prepare,
    mode: 'stop-container',
    shouldProceed: async () => false,
    provision: async () => { raceProvisions += 1; return true; },
  }, {
    claimExternal: async () => true,
    maintain,
    recover: async () => { dockerCalls += 1; return { ok: false, reason: 'docker' }; },
  });
  eq(racedRun, { recovered: false, reason: 'race' }, 'editor/status race cancels after prepare');
  eq(dockerCalls, 0, 'race performs no Docker stop');
  eq(raceProvisions, 0, 'race performs no reprovision');
  eq((await prisma.agentSession.findUnique({ where: { id: raced.session.id } }))?.status, 'busy', 'race cancel restores old session state');

  // Complete without a provisioned successor is unavailable (not success), leaves a
  // stopped retry row, and the next call skips Docker then proves the higher-fence session.
  const unavailable = await fixture('unavailable-successor', Date.now() - 30_001);
  let unavailableDockerCalls = 0;
  const unavailableRun = await runAgentRecovery({
    prepare: unavailable.prepare,
    mode: 'kill-claude',
    provision: async () => false,
  }, {
    claimExternal: async () => true,
    maintain,
    recover: async () => {
      unavailableDockerCalls += 1;
      return { ok: true, container: { workspaceId, projectId: project.id, ticketKey: unavailable.ticket.key, containerId: unavailable.session.containerId ?? '', name: 'unavailable-container' } };
    },
  });
  eq(unavailableRun, { recovered: false, reason: 'unavailable' }, 'missing successor is reported unavailable instead of recovered');
  eq((await prisma.agentSession.findUnique({ where: { id: unavailable.session.id } }))?.status, 'stopped', 'completed recovery stays visible as a stopped provisioning retry');
  const retriedUnavailable = await runAgentRecovery({
    prepare: unavailable.prepare,
    mode: 'kill-claude',
    provision: async () => {
      const successor = await capacity.acquireSlot(unavailable.ticket.key, workspaceId, false, Date.now());
      if (!successor.acquired) return false;
      held.push(successor.reservation);
      await prisma.agentSession.update({
        where: { id: unavailable.session.id },
        data: { status: 'stopped', runToken: successor.reservation.runToken, runFence: successor.reservation.fence },
      });
      return true;
    },
  }, {
    claimExternal: async () => { throw new Error('stopped retry must not claim external Docker'); },
    maintain,
    recover: async () => { unavailableDockerCalls += 1; return { ok: false, reason: 'docker' }; },
  });
  assert(retriedUnavailable.recovered, 'stopped recovery retry succeeds after proving the exact successor');
  eq(unavailableDockerCalls, 1, 'stopped provisioning retry never repeats the destructive Docker phase');

  // Redis transport uncertainty throws before either complete or cancel can advance
  // AgentSession. Both rows remain recovering for deterministic cron retry.
  const strictComplete = await fixture('strict-complete', Date.now() - 30_001);
  await enqueueInternalAction(strictComplete.prepare);
  const strictCompleteAction = {
    workspaceId,
    op: 'agent-recovery-transition' as const,
    target: strictComplete.prepare.target,
    payload: {
      phase: 'complete' as const,
      reason: strictComplete.prepare.payload.reason,
      expected: strictComplete.prepare.payload.expected,
      intentId: recoveryIntentId(workspaceId, strictComplete.requestId),
    },
    userId: 'recovery-test',
    clientRequestId: `strict-complete-${String(stamp)}`,
  };
  const [strictCompleteError] = await tryCatch(() => runInTenant(workspaceId, () => runInWriterContext(workspaceId, () => applyAgentRecoveryTransition(
    prisma,
    workspaceId,
    strictCompleteAction,
    {
      owns: async () => true,
      release: async () => { throw new Error('redis unavailable'); },
      cancel: async () => true,
      fence: async () => strictComplete.old.fence + 1,
    },
  ))));
  assert(strictCompleteError !== null, 'strict complete surfaces Redis release uncertainty');
  eq((await prisma.agentSession.findUnique({ where: { id: strictComplete.session.id } }))?.status, 'recovering', 'Redis-uncertain complete does not set stopped');
  await runAgentRecovery({ prepare: strictComplete.prepare, mode: 'kill-claude' }, {
    claimExternal: async () => true,
    maintain,
    recover: async () => ({ ok: false, reason: 'docker' }),
  });

  const strictCancel = await fixture('strict-cancel', Date.now() - 30_001);
  await enqueueInternalAction(strictCancel.prepare);
  const strictCancelAction = {
    workspaceId,
    op: 'agent-recovery-transition' as const,
    target: strictCancel.prepare.target,
    payload: {
      phase: 'cancel' as const,
      reason: strictCancel.prepare.payload.reason,
      expected: strictCancel.prepare.payload.expected,
      intentId: recoveryIntentId(workspaceId, strictCancel.requestId),
    },
    userId: 'recovery-test',
    clientRequestId: `strict-cancel-${String(stamp)}`,
  };
  const [strictCancelError] = await tryCatch(() => runInTenant(workspaceId, () => runInWriterContext(workspaceId, () => applyAgentRecoveryTransition(
    prisma,
    workspaceId,
    strictCancelAction,
    {
      owns: async () => true,
      release: async () => true,
      cancel: async () => { throw new Error('redis unavailable'); },
      fence: async () => strictCancel.old.fence + 1,
    },
  ))));
  assert(strictCancelError !== null, 'strict cancel surfaces Redis uncertainty');
  eq((await prisma.agentSession.findUnique({ where: { id: strictCancel.session.id } }))?.status, 'recovering', 'Redis-uncertain cancel does not restore the old status');
  await runAgentRecovery({ prepare: strictCancel.prepare, mode: 'kill-claude' }, {
    claimExternal: async () => true,
    maintain,
    recover: async () => ({ ok: false, reason: 'docker' }),
  });

  // The real provision API reports its typed queued status and preserves a retry when
  // Docker is unavailable; it never silently returns success.
  number += 1;
  const noDockerKey = `DEV-${String(number)}`;
  await prisma.ticket.create({ data: { workspaceId, projectId: project.id, key: noDockerKey, number, title: 'no-docker', stageId: stage.key, status: 'busy', archived: false, branch: noDockerKey, labels: [], priority: 'normal' } });
  const noDocker = await provisionContainers(
    workspaceId,
    [{ key: noDockerKey, branch: noDockerKey }],
    stage.key,
    false,
    undefined,
    { dockerAvailable: async () => false },
  );
  eq(noDocker, [{ key: noDockerKey, status: 'queued' }], 'Docker-unavailable provision returns queued instead of success');
  eq(await capacity.dequeueDeferred(), { workspaceId, key: noDockerKey, stageId: stage.key }, 'Docker-unavailable provision leaves a durable capacity retry');

  // A fenced manual kill parks the ticket only after prepare, restores busy on Docker cancel, and
  // leaves it paused after completed destructive teardown.
  const manualCanceled = await fixture('manual-cancel', Date.now() - 30_001, 'manual-kill');
  const canceledManualRun = await runAgentRecovery({ prepare: manualCanceled.prepare, mode: 'kill-claude' }, {
    claimExternal: async () => true,
    maintain,
    recover: async () => ({ ok: false, reason: 'docker' }),
  });
  eq(canceledManualRun, { recovered: false, reason: 'docker' }, 'failed fenced manual kill reports Docker failure');
  eq((await prisma.ticket.findUnique({ where: { id: manualCanceled.ticket.id } }))?.status, 'busy', 'manual-kill cancel restores the prior ticket status');
  eq((await prisma.agentSession.findUnique({ where: { id: manualCanceled.session.id } }))?.status, 'busy', 'manual-kill cancel restores the prior session status');

  const manualCompleted = await fixture('manual-complete', Date.now() - 30_001, 'manual-kill');
  const completedManualRun = await runAgentRecovery({ prepare: manualCompleted.prepare, mode: 'kill-claude' }, {
    claimExternal: async () => true,
    maintain,
    recover: async () => ({ ok: true, container: { workspaceId, projectId: project.id, ticketKey: manualCompleted.ticket.key, containerId: manualCompleted.session.containerId ?? '', name: 'manual-complete' } }),
  });
  assert(completedManualRun.recovered, 'successful fenced manual kill completes without requiring a successor');
  eq((await prisma.ticket.findUnique({ where: { id: manualCompleted.ticket.id } }))?.status, 'paused', 'completed manual kill parks the ticket until explicit reactivation');
  eq((await prisma.agentSession.findUnique({ where: { id: manualCompleted.session.id } }))?.status, 'stopped', 'completed manual kill stops the exact session');

  // Public manual kill cannot ACK success unless its nested recovery prepare fenced the
  // active session synchronously. This fixture has no Redis owner, so the ACK is semantic failure.
  number += 1;
  const manualKey = `DEV-${String(number)}`;
  const manualTicket = await prisma.ticket.create({ data: { workspaceId, projectId: project.id, key: manualKey, number, title: 'manual-ack', stageId: stage.key, status: 'busy', archived: false, branch: manualKey, labels: [], priority: 'normal' } });
  const manualSession = await prisma.agentSession.create({ data: {
    workspaceId,
    ticketId: manualTicket.id,
    stageId: stage.key,
    kind: 'worker',
    sessionKey: `worker:${manualTicket.id}:${stage.key}`,
    status: 'busy',
    containerId: 'manual-no-owner-container',
    runToken: 'manual-no-owner-token',
    runFence: 999,
    startedAt: new Date(),
  } });
  const manualAck = await enqueueControlAction({
    workspaceId,
    op: 'kill',
    target: { ticketKey: manualKey },
    payload: {},
    userId: owner.id,
    clientRequestId: `manual-kill-ack-${String(stamp)}`,
  });
  assert(isControlActionFailure(manualAck.result), 'manual kill returns a failed public ACK when prepare is not applied');
  eq((await prisma.ticket.findUnique({ where: { id: manualTicket.id } }))?.status, 'busy', 'failed manual prepare leaves the ticket unchanged');
  eq((await prisma.agentSession.findUnique({ where: { id: manualSession.id } }))?.status, 'busy', 'failed manual prepare schedules no detached session mutation');

  // Exact Docker helper rejects label/owner mismatch and checks stop result + final state.
  const exact: WorkerContainerIdentity = { workspaceId, projectId: project.id, ticketKey: 'DEV-exact', containerId: 'exact-id', name: 'exact-name' };
  let stops = 0;
  const mismatch = await recoverExactContainer({ ...exact, runToken: 'old-token', runFence: 7 }, 'stop-container', {
    inspect: async () => ({ ...exact, workspaceId: 'foreign-workspace' }),
    readOwner: async () => ({ runToken: 'old-token', runFence: 7 }),
    killClaude: async () => true,
    stopContainer: async () => { stops += 1; return true; },
    running: async () => false,
  });
  eq(mismatch, { ok: false, reason: 'identity' }, 'label mismatch fails before stop');
  eq(stops, 0, 'identity mismatch stops no container');
  const stopFailure = await recoverExactContainer({ ...exact, runToken: 'old-token', runFence: 7 }, 'stop-container', {
    inspect: async () => exact,
    readOwner: async () => ({ runToken: 'old-token', runFence: 7 }),
    killClaude: async () => true,
    stopContainer: async () => false,
    running: async () => true,
  });
  eq(stopFailure, { ok: false, reason: 'docker' }, 'nonzero stop result fails closed');
  let replayOwnerReads = 0;
  let replayStops = 0;
  const stoppedReplay = await recoverExactContainer({ ...exact, runToken: 'old-token', runFence: 7 }, 'stop-container', {
    inspect: async () => exact,
    readOwner: async () => { replayOwnerReads += 1; return null; },
    killClaude: async () => true,
    stopContainer: async () => { replayStops += 1; return false; },
    running: async () => false,
  });
  eq(stoppedReplay, { ok: true, container: exact }, 'crash replay accepts the exact already-stopped container');
  eq(replayOwnerReads, 0, 'already-stopped replay needs no impossible Docker-exec owner read');
  eq(replayStops, 0, 'already-stopped replay does not repeat the destructive stop');

  let teardownCalls = 0;
  let teardownStops = 0;
  const tornDown = await recoverExactContainer({ ...exact, runToken: 'old-token', runFence: 7 }, 'teardown-container', {
    inspect: async () => exact,
    readOwner: async () => ({ runToken: 'old-token', runFence: 7 }),
    killClaude: async () => true,
    stopContainer: async () => { teardownStops += 1; return true; },
    teardownContainer: async () => { teardownCalls += 1; return true; },
    running: async () => teardownStops === 0,
  });
  eq(tornDown, { ok: true, container: exact }, 'manual teardown stops and removes the exact fenced container before completion');
  eq(teardownCalls, 1, 'manual teardown removes the exact container/volume once');
  let absentOwnerReads = 0;
  const absentReplay = await recoverExactContainer({ ...exact, runToken: 'old-token', runFence: 7 }, 'teardown-container', {
    inspect: async () => null,
    readOwner: async () => { absentOwnerReads += 1; return null; },
    killClaude: async () => true,
    stopContainer: async () => false,
    teardownContainer: async () => true,
    running: async () => null,
  });
  assert(absentReplay.ok, 'crash replay accepts an already-absent exact container and volume');
  eq(absentOwnerReads, 0, 'already-absent teardown replay never tries to read a dead container owner');

  // Runtime parser/result guard remains typed on terminal recovery results.
  const parsed = readRecoveryTransitionResult({ applied: false, phase: 'prepare', reason: 'stale', keys: [], intentId: 'd'.repeat(24) });
  eq(parsed?.applied, false, 'typed recovery result parser accepts bounded stale outcome');
} catch (error) {
  assert(false, `unexpected recovery error: ${String(error)}`);
} finally {
  for (const reservation of held) await capacity.releaseSlot(reservation);
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/recoveryWriter.test.mts');
