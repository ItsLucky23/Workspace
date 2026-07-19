//? Stage-run B3 single-writer regression suite. No live PTY/container/git: external boundaries are
//? represented by container run tokens and a precomputed bounded CI result; every production mutation enters
//? through a typed InternalOp and revalidates workspace/project/ticket/stage/session/container CAS.

import { redis, tryCatch } from '@luckystack/core';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';
import type { StageTurnCompleteInternalAction } from '../../server/orchestrator/internalOps';
import type { StageCiReport } from '../../server/ci/runner';

const prisma = await db();
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { assertValidInternalAction, enqueueInternalAction } = await import('../../server/orchestrator/internalOps');
const {
  applyStageTurnComplete,
  readStageForgeCompleteResult,
  readStageForgePrepareResult,
  readStageSessionStartResult,
  readStageTurnCompleteResult,
  stageActionPersisted,
  stageCompletionMarkerId,
} = await import('../../server/orchestrator/stageWriter');
const { currentWriterScope, runInWriterContext } = await import('../../server/orchestrator/writerContext');
const { runInTenant } = await import('../../server/tenant/tenantContext');
const { pushTicketWork } = await import('../../server/git/forge');
const { runStageCiInContainer } = await import('../../server/ci/runner');
const { deterministicObjectId, stageForgeIntentId } = await import('../../server/orchestrator/actionIds');
const capacity = await import('../../server/orchestrator/capacity');
const {
  cleanupFailedStageContainer,
  ensureStageContainerOwnership,
  persistToolTrail,
  projectAuth,
  resolveStageRuntime,
  resolveStageTurnWriterOutcome,
  runStageCiOutsideWriter,
  stableStageCompletionId,
  stableStageHandoffId,
  verifyStageContainerOwner,
} = await import('../../server/orchestrator/stageRunner');
const { drainCapacityQueue, resolveReprovisionTarget } = await import('../../server/orchestrator/conductor');

const stamp = Date.now();
const [capacityActiveKey, capacityOwnerKey] = capacity.capacityRedisKeys('stage-probe', 'ticket-probe', 'token-probe');
const capacityMembers: string[] = [];
const capacityIdentities: string[] = [];
const capacityHeartbeatKeys: string[] = [];
let nextRunFence = 0;
const owner = await prisma.user.create({ data: { email: `stage-writer-${String(stamp)}@youcomm.nl`, name: 'Stage writer owner' } });
let workspaceId = '';
let foreignWorkspaceId = '';

const stableCompletionFixture = { runToken: 'stable-run', runFence: 8, turnMarker: 'turn', message: 'same result', report: null };
eq(stableStageCompletionId(stableCompletionFixture), stableStageCompletionId(stableCompletionFixture), 'completion identity is stable across retries of the same fenced turn');
assert(stableStageCompletionId({ ...stableCompletionFixture, runFence: 9 }) !== stableStageCompletionId(stableCompletionFixture), 'a successor fence cannot collide with an old completion identity');
const stableHandoffFixture = { runToken: 'stable-run', runFence: 8, turnMarker: 'turn', claudeSessionId: 'claude-1', body: { summary: 'same' }, reason: 'budget' };
eq(stableStageHandoffId(stableHandoffFixture), stableStageHandoffId(stableHandoffFixture), 'handoff identity is stable across retries of the same fenced turn');

// Reused-container ownership is mutable inside /work. One atomic file lock covers marker read,
// Redis proof, predecessor kill, Redis recheck, marker replacement, and cleanup.
const takeoverOrder: string[] = [];
let ownerMarker = '3:owner-a';
let ownerLock = false;
const takeoverDocker = async (args: string[]) => {
  const command = args.join(' ');
  if (command.includes('mkdir /work/.workspaces-run-owner.lock')) {
    takeoverOrder.push('lock');
    if (ownerLock) return { code: 1, out: '', err: 'locked', timedOut: false, outputLimitExceeded: false };
    ownerLock = true;
    return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false };
  }
  if (command.includes('rmdir /work/.workspaces-run-owner.lock')) {
    takeoverOrder.push('unlock');
    ownerLock = false;
    return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false };
  }
  if (command.includes('cat /work/.workspaces-run-owner')) {
    takeoverOrder.push('read-marker');
    return { code: 0, out: ownerMarker, err: '', timedOut: false, outputLimitExceeded: false };
  }
  takeoverOrder.push('replace-marker');
  assert(ownerLock, 'marker replacement occurs only while the takeover lock is held');
  assert(command.includes('.workspaces-run-owner.tmp.$$') && command.includes('mv "$tmp" /work/.workspaces-run-owner'), 'owner marker replacement uses temp+atomic rename');
  assert(command.includes('rm -f /work/.claude/turn-stop.json'), 'takeover clears only the stale turn capture');
  assert(!command.includes('tool-calls.jsonl') && !command.includes('git'), 'takeover preserves tool recovery and every git commit in the volume');
  ownerMarker = '4:owner-b';
  return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false };
};
eq(await ensureStageContainerOwnership('reused-container', 'owner-ws', 'DEV-1', { runToken: 'owner-b', runFence: 4 }, {
  runDocker: takeoverDocker,
  ownsSlot: async () => { takeoverOrder.push('redis-owner'); return true; },
  killOldProcess: async () => { takeoverOrder.push('kill-old'); return true; },
}), true, 'successor B claims the reused container');
eq(takeoverOrder, ['lock', 'read-marker', 'redis-owner', 'kill-old', 'redis-owner', 'replace-marker', 'read-marker', 'unlock'], 'one lock covers both Redis checks, kill, and marker replacement');
eq(await verifyStageContainerOwner('reused-container', { runToken: 'owner-b', runFence: 4 }, takeoverDocker), true, 'the drive-time owner check accepts the exact successor marker');

const staleMatchingOrder: string[] = [];
let staleLock = false;
const staleMatchingOwner = await ensureStageContainerOwnership('reused-container', 'owner-ws', 'DEV-1', { runToken: 'owner-b', runFence: 4 }, {
  runDocker: async (args) => {
    const command = args.join(' ');
    if (command.includes('mkdir ')) { staleMatchingOrder.push('lock'); staleLock = true; return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false }; }
    if (command.includes('rmdir ')) { staleMatchingOrder.push('unlock'); staleLock = false; return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false }; }
    staleMatchingOrder.push('read-marker');
    return { code: 0, out: ownerMarker, err: '', timedOut: false, outputLimitExceeded: false };
  },
  ownsSlot: async () => { staleMatchingOrder.push('redis-owner'); return false; },
  killOldProcess: async () => { staleMatchingOrder.push('kill-old'); return true; },
});
eq(staleMatchingOwner, false, 'a matching stale marker without Redis authority fails closed');
eq(staleMatchingOrder, ['lock', 'read-marker', 'redis-owner', 'unlock'], 'matching-marker reuse still verifies Redis under the file lock');
eq(staleLock, false, 'failed matching-marker reuse cleans its lock');

const rejectedTakeoverOrder: string[] = [];
let rejectedLock = false;
const rejectedTakeover = await ensureStageContainerOwnership('reused-container', 'owner-ws', 'DEV-1', { runToken: 'owner-c', runFence: 5 }, {
  runDocker: async (args) => {
    const command = args.join(' ');
    if (command.includes('mkdir ')) { rejectedTakeoverOrder.push('lock'); rejectedLock = true; return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false }; }
    if (command.includes('rmdir ')) { rejectedTakeoverOrder.push('unlock'); rejectedLock = false; return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false }; }
    rejectedTakeoverOrder.push('read-marker');
    return { code: 0, out: ownerMarker, err: '', timedOut: false, outputLimitExceeded: false };
  },
  ownsSlot: async () => { rejectedTakeoverOrder.push('redis-owner'); return false; },
  killOldProcess: async () => { rejectedTakeoverOrder.push('kill-old'); return true; },
});
eq(rejectedTakeover, false, 'a marker mismatch without the new Redis reservation fails closed');
eq(rejectedTakeoverOrder, ['lock', 'read-marker', 'redis-owner', 'unlock'], 'reservation mismatch kills no process and replaces no marker');
eq(rejectedLock, false, 'rejected takeover cleans its lock');

// A proves Redis, pauses in kill, expires, and B acquires Redis. B cannot interleave the
// container mutation because A holds the file lock; A's second Redis check then fails closed.
let raceLock = false;
let raceMarker = '8:owner-a';
let continueKill = (): void => undefined;
let signalKill = (): void => undefined;
const killPaused = new Promise<void>((resolve) => { signalKill = resolve; });
const killContinue = new Promise<void>((resolve) => { continueKill = resolve; });
const raceDocker = async (args: string[]) => {
  const command = args.join(' ');
  if (command.includes('mkdir ')) {
    if (raceLock) return { code: 1, out: '', err: 'locked', timedOut: false, outputLimitExceeded: false };
    raceLock = true;
    return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false };
  }
  if (command.includes('rmdir ')) { raceLock = false; return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false }; }
  if (command.includes('cat ')) return { code: 0, out: raceMarker, err: '', timedOut: false, outputLimitExceeded: false };
  raceMarker = '9:owner-a-stale';
  return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false };
};
let raceOwnerChecks = 0;
const ownerA = ensureStageContainerOwnership('race-container', 'owner-ws', 'DEV-race', { runToken: 'owner-a-next', runFence: 9 }, {
  runDocker: raceDocker,
  ownsSlot: async () => { raceOwnerChecks += 1; return raceOwnerChecks === 1; },
  killOldProcess: async () => { signalKill(); await killContinue; return true; },
});
await killPaused;
const ownerB = await ensureStageContainerOwnership('race-container', 'owner-ws', 'DEV-race', { runToken: 'owner-b', runFence: 10 }, {
  runDocker: raceDocker,
  ownsSlot: async () => true,
  killOldProcess: async () => true,
});
eq(ownerB, false, 'B cannot interleave marker takeover while A holds the atomic lock');
continueKill();
eq(await ownerA, false, 'A fails after its post-kill Redis recheck observes B as successor');
eq(raceMarker, '8:owner-a', 'expired A never overwrites the marker after B acquires Redis');
eq(raceLock, false, 'the raced loser cleans the takeover lock');

const [runError] = await tryCatch(async () => {
  const created = await createBlankWorkspace(prisma, owner.id, 'Stage writer WS');
  workspaceId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
  assert(project !== null, 'the workspace has a project');
  if (!project) return;

  const foreign = await createBlankWorkspace(prisma, owner.id, 'Foreign stage writer WS');
  foreignWorkspaceId = foreign.workspaceId;

  let ticketNumber = 7000;
  async function ticketAt(stageId: string, suffix: string, branch: string | null = `DEV-${suffix}`) {
    ticketNumber += 1;
    return prisma.ticket.create({
      data: {
        workspaceId,
        projectId: project.id,
        key: `DEV-${String(ticketNumber)}`,
        number: ticketNumber,
        title: `Stage writer ${suffix}`,
        stageId,
        status: 'busy',
        branch,
        labels: [],
        priority: 'normal',
      },
    });
  }

  async function setCapacityOwner(ticketKey: string, runToken: string, ownerWorkspaceId = workspaceId) {
    nextRunFence += 1;
    const runFence = nextRunFence;
    const identity = `${ownerWorkspaceId}::${ticketKey}`;
    const member = `${identity}::${String(runFence)}::${runToken}`;
    const heartbeat = capacity.capacityRedisKeys(ownerWorkspaceId, ticketKey, runToken)[5] ?? '';
    await redis.zadd(capacityActiveKey, Date.now(), member);
    await redis.hset(capacityOwnerKey, identity, member);
    await redis.set(heartbeat, member, 'PX', 60_000);
    capacityMembers.push(member);
    capacityIdentities.push(identity);
    capacityHeartbeatKeys.push(heartbeat);
    return runFence;
  }

  async function start(ticket: Awaited<ReturnType<typeof ticketAt>>, containerId: string, runToken = `${containerId}-run-token`) {
    const runFence = await setCapacityOwner(ticket.key, runToken);
    const action = await enqueueInternalAction({
      workspaceId,
      op: 'stage-session-start',
      target: { ticketId: ticket.id, ticketKey: ticket.key, projectId: ticket.projectId, stageId: ticket.stageId },
      payload: { sessionKey: `worker:${ticket.id}:${ticket.stageId}`, runToken, runFence, containerId, model: 'sonnet', cliVersion: 'test-cli' },
      userId: 'stage-runner-test',
      clientRequestId: `stage-start-${ticket.key}-${containerId}-${runToken}-${String(stamp)}`,
    });
    const result = readStageSessionStartResult(action.result);
    assert(result?.applied === true, `${ticket.key} session start applies`);
    if (!result?.applied) throw new Error('session start fixture failed');
    return result.session;
  }

  function target(ticket: Awaited<ReturnType<typeof ticketAt>>, session: { id: string; runToken: string; runFence: number }) {
    return { ticketId: ticket.id, ticketKey: ticket.key, projectId: ticket.projectId, stageId: ticket.stageId, sessionId: session.id, runToken: session.runToken, runFence: session.runFence };
  }

  function completion(
    ticket: Awaited<ReturnType<typeof ticketAt>>,
    session: { id: string; runToken: string; runFence: number },
    containerId: string,
    turn: StageTurnCompleteInternalAction['payload']['turn'],
    requestId: string,
    ci?: StageTurnCompleteInternalAction['payload']['ci'],
  ): StageTurnCompleteInternalAction {
    return {
      workspaceId,
      op: 'stage-turn-complete',
      target: target(ticket, session),
      payload: {
        containerId,
        claudeSessionId: `${containerId}-claude`,
        turn,
        spend: { userId: owner.id, model: 'sonnet', inputChars: 40, outputChars: 20 },
        ...(ci ? { ci } : {}),
      },
      userId: 'stage-runner-test',
      clientRequestId: requestId,
    };
  }

  // Every successor start resets the watchdog clock and clears an inherited heartbeat.
  const restartTicket = await ticketAt('refined', 'started-at-reset');
  const firstRestartSession = await start(restartTicket, 'container-started-at');
  const oldStartedAt = new Date(Date.now() - 60 * 60 * 1000);
  await prisma.agentSession.update({ where: { id: firstRestartSession.id }, data: { startedAt: oldStartedAt, lastHeartbeatAt: oldStartedAt } });
  const restartedSession = await start(restartTicket, 'container-started-at', 'started-at-successor-token');
  const restartedRow = await prisma.agentSession.findUnique({ where: { id: restartedSession.id }, select: { startedAt: true, lastHeartbeatAt: true } });
  assert((restartedRow?.startedAt.getTime() ?? 0) > oldStartedAt.getTime(), 'successor stage-session-start resets startedAt to now');
  eq(restartedRow?.lastHeartbeatAt, null, 'successor stage-session-start clears lastHeartbeatAt');

  // Exact workspace/project/stage validation: no AgentSession may be minted for a foreign target.
  const wrongTicket = await ticketAt('refined', 'wrong-scope');
  const wrongProjectFence = await setCapacityOwner(wrongTicket.key, 'wrong-project-token');
  const wrongProject = await enqueueInternalAction({
    workspaceId,
    op: 'stage-session-start',
    target: { ticketId: wrongTicket.id, ticketKey: wrongTicket.key, projectId: '000000000000000000000001', stageId: 'refined' },
    payload: { sessionKey: `worker:${wrongTicket.id}:refined`, runToken: 'wrong-project-token', runFence: wrongProjectFence, containerId: 'wrong-project-container', model: 'sonnet', cliVersion: 'test-cli' },
    userId: 'stage-runner-test',
    clientRequestId: `wrong-project-${String(stamp)}`,
  });
  eq(readStageSessionStartResult(wrongProject.result)?.applied, false, 'wrong-project session start is ignored');
  const wrongWorkspace = await enqueueInternalAction({
    workspaceId: foreignWorkspaceId,
    op: 'stage-session-start',
    target: { ticketId: wrongTicket.id, ticketKey: wrongTicket.key, projectId: wrongTicket.projectId, stageId: 'refined' },
    payload: { sessionKey: `worker:${wrongTicket.id}:refined`, runToken: 'wrong-workspace-token', runFence: 1, containerId: 'wrong-workspace-container', model: 'sonnet', cliVersion: 'test-cli' },
    userId: 'stage-runner-test',
    clientRequestId: `wrong-workspace-${String(stamp)}`,
  });
  eq(readStageSessionStartResult(wrongWorkspace.result)?.applied, false, 'wrong-workspace session start is ignored');
  eq(await prisma.agentSession.count({ where: { ticketId: wrongTicket.id } }), 0, 'wrong scope creates no AgentSession');

  // External branch creation returns only branch+HEAD; the writer applies it after exact revalidation.
  const activationTicket = await ticketAt('refined', 'activation', null);
  const activationAction = {
    workspaceId,
    op: 'stage-activation-complete' as const,
    target: { ticketId: activationTicket.id, ticketKey: activationTicket.key, projectId: activationTicket.projectId, stageId: 'refined' },
    payload: { branch: activationTicket.key, commitHash: 'activation-head' },
    userId: 'stage-runner-test',
    clientRequestId: `stage-activation-${String(stamp)}`,
  };
  await enqueueInternalAction(activationAction);
  await enqueueInternalAction(activationAction);
  eq(
    await prisma.ticket.findUnique({ where: { id: activationTicket.id }, select: { branch: true, commitHash: true } }),
    { branch: activationTicket.key, commitHash: 'activation-head' },
    'duplicate activation completion applies branch+HEAD once through the writer',
  );

  // Archived/done/paused tickets are rejected at every pre-runtime boundary.
  const archivedTicket = await ticketAt('refined', 'archived-runtime', null);
  await prisma.ticket.update({ where: { id: archivedTicket.id }, data: { archived: true } });
  const archivedActivation = await enqueueInternalAction({
    workspaceId,
    op: 'stage-activation-complete',
    target: { ticketId: archivedTicket.id, ticketKey: archivedTicket.key, projectId: archivedTicket.projectId, stageId: archivedTicket.stageId },
    payload: { branch: archivedTicket.key, commitHash: 'must-not-land' },
    userId: 'stage-runner-test',
    clientRequestId: `archived-activation-${String(stamp)}`,
  });
  eq(stageActionPersisted(archivedActivation.result, archivedTicket.key), false, 'archived ticket rejects activation completion');
  const archivedFence = await setCapacityOwner(archivedTicket.key, 'archived-start-token');
  const archivedStart = await enqueueInternalAction({
    workspaceId,
    op: 'stage-session-start',
    target: { ticketId: archivedTicket.id, ticketKey: archivedTicket.key, projectId: archivedTicket.projectId, stageId: archivedTicket.stageId },
    payload: { sessionKey: `worker:${archivedTicket.id}:${archivedTicket.stageId}`, runToken: 'archived-start-token', runFence: archivedFence, containerId: 'archived-container', model: 'sonnet', cliVersion: 'test-cli' },
    userId: 'stage-runner-test',
    clientRequestId: `archived-start-${String(stamp)}`,
  });
  eq(readStageSessionStartResult(archivedStart.result)?.applied, false, 'archived ticket cannot start an AgentSession');
  eq(await resolveStageRuntime(prisma, workspaceId, archivedTicket.key, archivedTicket.stageId), null, 'runStage runtime resolution rejects archived tickets');
  eq(await resolveReprovisionTarget(prisma, workspaceId, archivedTicket.key), null, 'reprovision rejects archived tickets');

  const doneRuntimeTicket = await ticketAt('refined', 'done-runtime');
  await prisma.ticket.update({ where: { id: doneRuntimeTicket.id }, data: { status: 'done' } });
  eq(await resolveStageRuntime(prisma, workspaceId, doneRuntimeTicket.key, doneRuntimeTicket.stageId), null, 'runStage runtime resolution rejects done tickets');
  eq(await resolveReprovisionTarget(prisma, workspaceId, doneRuntimeTicket.key), null, 'reprovision rejects done tickets');
  const pausedRuntimeTicket = await ticketAt('refined', 'paused-runtime');
  await prisma.ticket.update({ where: { id: pausedRuntimeTicket.id }, data: { status: 'paused' } });
  eq(await resolveStageRuntime(prisma, workspaceId, pausedRuntimeTicket.key, pausedRuntimeTicket.stageId), null, 'runStage runtime resolution rejects paused tickets');
  eq(await resolveReprovisionTarget(prisma, workspaceId, pausedRuntimeTicket.key), null, 'reprovision rejects paused tickets');

  // Reused container id is NOT identity. A successor runToken wins; old completion/handoff are zero-write stale results.
  const staleTicket = await ticketAt('refined', 'stale');
  const oldSession = await start(staleTicket, 'container-reused', 'run-token-old');
  const currentSession = await start(staleTicket, 'container-reused', 'run-token-successor');
  eq(currentSession.id, oldSession.id, 'session start upserts the bounded logical worker projection');
  assert(currentSession.runFence > oldSession.runFence, 'successor B receives and stores a higher run fence than old A');
  const expiredOwnerRestart = await enqueueInternalAction({
    workspaceId,
    op: 'stage-session-start',
    target: { ticketId: staleTicket.id, ticketKey: staleTicket.key, projectId: staleTicket.projectId, stageId: staleTicket.stageId },
    payload: { sessionKey: `worker:${staleTicket.id}:${staleTicket.stageId}`, runToken: oldSession.runToken, runFence: oldSession.runFence, containerId: 'container-reused', model: 'sonnet', cliVersion: 'test-cli' },
    userId: 'stage-runner-test',
    clientRequestId: `expired-owner-restart-${String(stamp)}`,
  });
  eq(readStageSessionStartResult(expiredOwnerRestart.result)?.applied, false, 'expired owner A cannot overwrite successor B runToken');
  eq((await prisma.agentSession.findUnique({ where: { id: currentSession.id } }))?.runToken, currentSession.runToken, 'successor B remains DB authority after old A retries session-start');
  const staleSpendBefore = await prisma.spendRecord.count({ where: { ticketId: staleTicket.id } });
  const staleCarryBefore = await prisma.carryOver.count({ where: { ticketId: staleTicket.id } });
  const staleEventsBefore = await prisma.ticketEvent.count({ where: { ticketId: staleTicket.id } });
  const staleHandoffsBefore = await prisma.handoff.count({ where: { ticketId: staleTicket.id } });
  const staleCompletion = await enqueueInternalAction(completion(
    staleTicket,
    oldSession,
    'container-reused',
    { kind: 'done', envelope: { summary: 'must not land', changedFiles: [], openQuestions: [] } },
    `stale-complete-${String(stamp)}`,
  ));
  eq(readStageTurnCompleteResult(staleCompletion.result)?.applied, false, 'old runToken completion is ignored even though the container id was reused');
  await enqueueInternalAction({
    workspaceId,
    op: 'stage-handoff-complete',
    target: target(staleTicket, oldSession),
    payload: {
      containerId: 'container-reused',
      expectedClaudeSessionId: 'old-claude',
      body: { summary: 'must not land', decisions: [], state: '', next: [], gotchas: [] },
      reason: 'budget',
    },
    userId: 'stage-runner-test',
    clientRequestId: `stale-handoff-${String(stamp)}`,
  });
  eq(await prisma.spendRecord.count({ where: { ticketId: staleTicket.id } }), staleSpendBefore, 'stale completion writes no SpendRecord');
  eq(await prisma.carryOver.count({ where: { ticketId: staleTicket.id } }), staleCarryBefore, 'stale completion writes no CarryOver');
  eq(await prisma.ticketEvent.count({ where: { ticketId: staleTicket.id } }), staleEventsBefore, 'stale completion writes no TicketEvent');
  eq(await prisma.handoff.count({ where: { ticketId: staleTicket.id } }), staleHandoffsBefore, 'stale handoff writes no Handoff');
  eq((await prisma.ticket.findUnique({ where: { id: staleTicket.id } }))?.stageId, 'refined', 'stale completion does not advance the ticket');

  // Tool trail append is writer-sequenced and idempotent even with a new Conductor request id.
  const manualTrailMarker = 'c'.repeat(64);
  const trailEntries = [
    { eventId: deterministicObjectId(workspaceId, 'manual-trail', 'edit'), type: 'file-change' as const, text: 'Edit: src/a.ts', metadata: { tool: 'Edit', ok: true, changedFiles: ['src/a.ts'], turnMarker: manualTrailMarker, occurrence: 0 } },
    { eventId: deterministicObjectId(workspaceId, 'manual-trail', 'bash'), type: 'command' as const, text: 'Bash: npm test', metadata: { tool: 'Bash', ok: true, turnMarker: manualTrailMarker, occurrence: 0 } },
  ];
  for (const request of ['first', 'replay']) {
    await enqueueInternalAction({
      workspaceId,
      op: 'stage-tool-trail-append',
      target: target(staleTicket, currentSession),
      payload: { containerId: 'container-reused', entries: trailEntries },
      userId: 'stage-runner-test',
      clientRequestId: `trail-${request}-${String(stamp)}`,
    });
  }
  eq(await prisma.ticketEvent.count({ where: { ticketId: staleTicket.id } }), 2, 'tool trail replay appends each parsed entry once');
  eq((await prisma.ticketEvent.findMany({ where: { ticketId: staleTicket.id }, orderBy: { seq: 'asc' }, select: { seq: true } })).map((event) => event.seq), [1, 2], 'tool trail seq is allocated under the writer in order');

  // Tool-trail file lifecycle: project auth keeps it; only writer-proven persistence truncates it.
  const authCommands: string[] = [];
  await projectAuth('container-reused', async (args) => {
    authCommands.push(args.join(' '));
    return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false };
  });
  assert(!authCommands.join('\n').includes('tool-calls.jsonl'), 'session projectAuth never deletes TOOL_TRAIL');

  const dockerCommands: string[] = [];
  const persistentMarker = 'd'.repeat(64);
  let cleanupExitCode = 0;
  let trailRaw = '{"tool_name":"Edit","tool_input":{"file_path":"src/replay.ts"}}';
  const fakeTrailDocker = async (args: string[]) => {
    const command = args.join(' ');
    dockerCommands.push(command);
    return {
      code: command.includes('.persisted-backup') ? cleanupExitCode : 0,
      out: command.includes('tail -c')
        ? trailRaw
        : (command.includes('stage-turn-marker') && command.includes('cat') ? persistentMarker : ''),
      err: '',
      timedOut: false,
      outputLimitExceeded: false,
    };
  };
  const trailInput = {
    container: 'container-reused',
    containerId: 'container-reused',
    workspaceId,
    target: target(staleTicket, currentSession),
    turnMarker: persistentMarker,
  };
  await persistToolTrail(trailInput, { runDocker: fakeTrailDocker });
  await persistToolTrail(trailInput, { runDocker: fakeTrailDocker });
  eq(await prisma.ticketEvent.count({ where: { ticketId: staleTicket.id } }), 3, 'restart replay with the same marker appends the raw tool call once');
  eq(dockerCommands.filter((command) => command.includes(': >')).length, 2, 'fresh success and terminal replay both truncate/remove only after persistence proof');
  await persistToolTrail({ ...trailInput, target: target(staleTicket, oldSession) }, { runDocker: fakeTrailDocker });
  eq(dockerCommands.filter((command) => command.includes(': >')).length, 2, 'stale writer outcome leaves TOOL_TRAIL and marker intact');
  await persistToolTrail(trailInput, {
    runDocker: fakeTrailDocker,
    enqueue: async () => { throw new Error('injected enqueue failure'); },
  });
  eq(dockerCommands.filter((command) => command.includes(': >')).length, 2, 'failed writer enqueue leaves TOOL_TRAIL and marker intact');
  cleanupExitCode = 23;
  eq(await persistToolTrail(trailInput, { runDocker: fakeTrailDocker }), 0, 'nonzero Docker cleanup is not reported as truncation success');
  assert(dockerCommands.some((command) => command.includes('.persisted-backup') && command.includes('cp')), 'cleanup command carries rollback backups so a nonzero exit restores both files');
  //? The failed cleanup retained the old line + persistent turn marker. A successor
  //? reservation appends one line: old eventId upserts, only the new event is added.
  trailRaw += '\n{"tool_name":"Bash","tool_input":{"command":"npm run build"}}';
  const toolSuccessor = await start(staleTicket, 'container-reused', 'run-token-tool-successor');
  cleanupExitCode = 0;
  eq(await persistToolTrail({ ...trailInput, target: target(staleTicket, toolSuccessor) }, { runDocker: fakeTrailDocker }), 1, 'successor token persists only the appended tool line after cleanup failure');
  eq(await prisma.ticketEvent.count({ where: { ticketId: staleTicket.id } }), 4, 'retained old line is not duplicated when a successor appends a new line');

  let cleanupCalls = 0;
  const cleanup = async () => { cleanupCalls += 1; };
  const cleanupDeps = {
    ownsSlot: async (_workspaceId: string, _ticketKey: string, runToken: string) => runToken === toolSuccessor.runToken,
    readRunOwner: async () => ({ runToken: toolSuccessor.runToken, runFence: toolSuccessor.runFence }),
    teardown: cleanup,
  };
  await cleanupFailedStageContainer(workspaceId, staleTicket.key, toolSuccessor.runToken, toolSuccessor.runFence, { containerId: 'reused', name: 'reused', volume: 'reused', created: false }, cleanupDeps);
  await cleanupFailedStageContainer(workspaceId, staleTicket.key, oldSession.runToken, oldSession.runFence, { containerId: 'old', name: 'old', volume: 'old', created: true }, cleanupDeps);
  await cleanupFailedStageContainer(workspaceId, staleTicket.key, toolSuccessor.runToken, toolSuccessor.runFence, { containerId: 'wrong-marker', name: 'wrong-marker', volume: 'wrong-marker', created: true }, { ...cleanupDeps, readRunOwner: async () => ({ runToken: oldSession.runToken, runFence: oldSession.runFence }) });
  await cleanupFailedStageContainer(workspaceId, staleTicket.key, toolSuccessor.runToken, toolSuccessor.runFence, { containerId: 'created', name: 'created', volume: 'created', created: true }, cleanupDeps);
  eq(cleanupCalls, 1, 'cleanup requires created + live slot owner + matching mutable volume owner marker');

  // Guarded failed drive status update.
  await enqueueInternalAction({
    workspaceId,
    op: 'stage-session-update',
    target: target(staleTicket, toolSuccessor),
    payload: { containerId: 'container-reused', status: 'stopped' },
    userId: 'stage-runner-test',
    clientRequestId: `failed-drive-${String(stamp)}`,
  });
  eq((await prisma.agentSession.findUnique({ where: { id: toolSuccessor.id } }))?.status, 'stopped', 'failed drive status applies through guarded InternalOp');

  // Needs-input: full question set + claude id + spend apply together; duplicate request is idempotent.
  const needsTicket = await ticketAt('refined', 'needs-input');
  const needsSession = await start(needsTicket, 'container-needs');
  const needsAction = completion(needsTicket, needsSession, 'container-needs', { kind: 'needs-input', questions: ['First?', 'Second?'] }, `needs-complete-${String(stamp)}`);
  const needsFirst = await enqueueInternalAction(needsAction);
  await enqueueInternalAction(needsAction);
  eq(readStageTurnCompleteResult(needsFirst.result)?.applied, true, 'needs-input completion applies');
  const needsRow = await prisma.ticket.findUnique({ where: { id: needsTicket.id }, select: { needsInput: true, needsInputQuestions: true, status: true } });
  eq(needsRow?.needsInput, 'First?', 'first full-set question remains the board banner');
  assert(JSON.stringify(needsRow?.needsInputQuestions).includes('Second?'), 'the complete question set is persisted');
  eq(needsRow?.status, 'needs-input', 'needs-input parks the ticket');
  eq(await prisma.spendRecord.count({ where: { ticketId: needsTicket.id } }), 1, 'duplicate needs-input completion writes one SpendRecord');
  eq((await prisma.agentSession.findUnique({ where: { id: needsSession.id } }))?.claudeSessionId, 'container-needs-claude', 'turn completion captures claudeSessionId under writer CAS');

  // Done + ungated: carry-over, spend, stopped session, and project-local next-stage advancement.
  const doneTicket = await ticketAt('refined', 'done');
  const doneSession = await start(doneTicket, 'container-done');
  const done = await enqueueInternalAction(completion(
    doneTicket,
    doneSession,
    'container-done',
    { kind: 'done', envelope: { summary: 'done summary', changedFiles: ['src/done.ts'], openQuestions: [] } },
    `done-complete-${String(stamp)}`,
  ));
  const doneResult = readStageTurnCompleteResult(done.result);
  eq(doneResult?.applied, true, 'done completion applies');
  eq(doneResult?.gated, false, 'ungated stage remains ungated');
  eq((await prisma.ticket.findUnique({ where: { id: doneTicket.id } }))?.stageId, 'plan', 'done ungated ticket advances to the next project stage');
  eq(await prisma.carryOver.count({ where: { ticketId: doneTicket.id } }), 1, 'done appends one CarryOver');
  eq((await prisma.agentSession.findUnique({ where: { id: doneSession.id } }))?.status, 'stopped', 'done stops the worker session');

  // Partial earlier writes remain repairable even if the ticket advance already made
  // the original stage predicate stale before the completion marker could land.
  const partialTicket = await ticketAt('refined', 'partial-before-marker');
  const partialSession = await start(partialTicket, 'container-partial-before-marker');
  const partialAction = completion(
    partialTicket,
    partialSession,
    'container-partial-before-marker',
    { kind: 'done', envelope: { summary: 'partial summary', changedFiles: [], openQuestions: [] } },
    `partial-before-marker-${String(stamp)}`,
  );
  await prisma.spendRecord.create({
    data: {
      id: deterministicObjectId(workspaceId, partialAction.clientRequestId, 'stage-spend'),
      workspaceId,
      userId: owner.id,
      ticketId: partialTicket.id,
      stageId: partialTicket.stageId,
      sessionKey: `worker:${partialTicket.id}:${partialTicket.stageId}`,
      tokensIn: 1,
      tokensOut: 1,
      model: 'sonnet',
      costEstimate: 0,
      providerId: 'claude-cli',
      feature: 'pipeline-agent',
    },
  });
  await prisma.carryOver.create({
    data: {
      id: deterministicObjectId(workspaceId, partialAction.clientRequestId, 'stage-carry-over'),
      workspaceId,
      ticketId: partialTicket.id,
      fromStageId: partialTicket.stageId,
      toStageId: 'plan',
      sessionId: partialSession.id,
      envelope: { summary: 'partial summary', changedFiles: [], openQuestions: [] },
    },
  });
  await prisma.ticket.update({ where: { id: partialTicket.id }, data: { stageId: 'plan', carryOver: 'partial summary' } });
  const partialRepair = await enqueueInternalAction(partialAction);
  eq(readStageTurnCompleteResult(partialRepair.result)?.applied, true, 'partial pre-marker retry reconstructs the crossed stale boundary');
  assert(await prisma.ticketEvent.findUnique({ where: { id: stageCompletionMarkerId(workspaceId, partialAction.clientRequestId) } }) !== null, 'partial retry finishes the deterministic completion marker');
  eq((await prisma.agentSession.findUnique({ where: { id: partialSession.id } }))?.status, 'stopped', 'partial retry finishes the terminal session status');

  // Gated done stays put and requests forge handoff. MR URL apply is branch/session-CAS + idempotent.
  await prisma.pipelineStage.updateMany({ where: { workspaceId, projectId: project.id, key: 'refined' }, data: { gateForApproval: true } });

  const bypassTicket = await ticketAt('refined', 'dedup-bypass');
  const bypassSession = await start(bypassTicket, 'container-bypass');
  const bypassAction = completion(
    bypassTicket,
    bypassSession,
    'container-bypass',
    { kind: 'done', envelope: { summary: 'one durable result', changedFiles: [], openQuestions: [] } },
    `dedup-bypass-${String(stamp)}`,
  );
  await runInTenant(workspaceId, () => runInWriterContext(workspaceId, () => applyStageTurnComplete(prisma, workspaceId, bypassAction)));
  await runInTenant(workspaceId, () => runInWriterContext(workspaceId, () => applyStageTurnComplete(prisma, workspaceId, bypassAction)));
  eq(await prisma.spendRecord.count({ where: { ticketId: bypassTicket.id } }), 1, 'direct helper double-invoke cannot duplicate deterministic SpendRecord');
  eq(await prisma.carryOver.count({ where: { ticketId: bypassTicket.id } }), 1, 'direct helper double-invoke cannot duplicate deterministic CarryOver');

  const handoffTicket = await ticketAt('refined', 'handoff-partial');
  const handoffSession = await start(handoffTicket, 'container-handoff');
  await enqueueInternalAction({
    workspaceId,
    op: 'stage-session-update',
    target: target(handoffTicket, handoffSession),
    payload: { containerId: 'container-handoff', status: 'busy', claudeSessionId: 'handoff-claude' },
    userId: 'stage-runner-test',
    clientRequestId: `handoff-session-${String(stamp)}`,
  });
  const handoffAction = {
    workspaceId,
    op: 'stage-handoff-complete' as const,
    target: target(handoffTicket, handoffSession),
    payload: {
      containerId: 'container-handoff',
      expectedClaudeSessionId: 'handoff-claude',
      body: { summary: 'preseeded handoff', decisions: [], state: 'state', next: [], gotchas: [] },
      reason: 'budget' as const,
    },
    userId: 'stage-runner-test',
    clientRequestId: `handoff-partial-${String(stamp)}`,
  };
  await prisma.handoff.create({
    data: {
      id: deterministicObjectId(workspaceId, handoffAction.clientRequestId, 'stage-handoff'),
      workspaceId,
      sessionKey: `worker:${handoffTicket.id}:refined`,
      ticketId: handoffTicket.id,
      stageId: 'refined',
      body: handoffAction.payload.body,
      reason: 'budget',
    },
  });
  await enqueueInternalAction(handoffAction);
  eq(await prisma.handoff.count({ where: { ticketId: handoffTicket.id } }), 1, 'partial-preseeded Handoff converges without a duplicate');
  eq((await prisma.agentSession.findUnique({ where: { id: handoffSession.id } }))?.claudeSessionId, null, 'handoff retry completes the final session reset');

  const gatedTicket = await ticketAt('refined', 'gated', 'DEV-gated');
  const gatedSession = await start(gatedTicket, 'container-gated');
  const gated = await enqueueInternalAction(completion(
    gatedTicket,
    gatedSession,
    'container-gated',
    { kind: 'done', envelope: { summary: 'await approval', changedFiles: [], openQuestions: [] } },
    `gated-complete-${String(stamp)}`,
  ));
  const gatedResult = readStageTurnCompleteResult(gated.result);
  eq(gatedResult?.gated, true, 'gated completion reports the human gate');
  eq(gatedResult?.forgeRequired, true, 'gated completion requests external forge work');
  eq((await prisma.ticket.findUnique({ where: { id: gatedTicket.id } }))?.stageId, 'refined', 'gated ticket does not advance');

  // A failure after the completion marker but before WorkspaceSignal.processedAt must
  // retry to the original rich outcome, not a stale stopped-session result.
  const repairTicket = await ticketAt('refined', 'completion-repair', 'DEV-completion-repair');
  const repairSession = await start(repairTicket, 'container-completion-repair');
  const repairAction = completion(
    repairTicket,
    repairSession,
    'container-completion-repair',
    { kind: 'done', envelope: { summary: 'repair me', changedFiles: [], openQuestions: [] } },
    `completion-repair-${String(stamp)}`,
  );
  let leaseChecks = 0;
  const [processedMarkerFailure] = await tryCatch(() => enqueueInternalAction(repairAction, {
    workspaceLease: async (_workspaceId, fn) => fn({
      signal: new AbortController().signal,
      assertHeld: () => {
        leaseChecks += 1;
        if (leaseChecks === 4) throw new Error('injected failure before processedAt');
      },
    }),
  }));
  assert(processedMarkerFailure !== null, 'simulated post-marker processedAt failure reaches the caller');
  const completionMarker = await prisma.ticketEvent.findUnique({
    where: { id: stageCompletionMarkerId(workspaceId, repairAction.clientRequestId) },
    select: { metadata: true },
  });
  eq(completionMarker?.metadata, { forgeRequired: true, pipelineDone: false, gated: true, ciBlocked: false }, 'completion marker stores only the bounded downstream decision');
  eq((await prisma.agentSession.findUnique({ where: { id: repairSession.id } }))?.status, 'stopped', 'the first attempt reached terminal session status before processedAt failed');
  const repairSignalsBeforeRetry = await prisma.workspaceSignal.findMany({
    where: { workspaceId, kind: 'stage-turn-complete' },
    select: { payload: true, processedAt: true },
  });
  eq(repairSignalsBeforeRetry.filter((signal) => JSON.stringify(signal.payload).includes(repairAction.clientRequestId) && signal.processedAt === null).length, 1, 'the simulated first signal remains visibly unprocessed');

  const repairedCompletion = await enqueueInternalAction(repairAction);
  const repairedResult = readStageTurnCompleteResult(repairedCompletion.result);
  eq(repairedResult?.forgeRequired, true, 'retry reconstructs the original forge-required outcome from the marker');
  assert(stageActionPersisted(repairedCompletion.result, repairTicket.key), 'retry repairs to a processed applied result instead of stale');
  const repairedPrepareId = `repair-forge-prepare-${String(stamp)}`;
  const repairedPrepare = await enqueueInternalAction({
    workspaceId,
    op: 'stage-forge-prepare',
    target: target(repairTicket, repairSession),
    payload: { containerId: 'container-completion-repair', expectedBranch: 'DEV-completion-repair' },
    userId: 'stage-runner-test',
    clientRequestId: repairedPrepareId,
  });
  eq(readStageForgePrepareResult(repairedPrepare.result)?.applied, true, 'processed-marker retry reaches durable forge prepare');

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      gitConfig: {
        branchStrategy: 'ticket-prefix', defaultBranchType: 'feature', branchTemplate: '{{key}}',
        pushPolicy: 'merge-request', targetBranch: 'main', protectedBranches: ['main'], commitSigning: false,
      },
    },
  });
  await prisma.project.update({ where: { id: project.id }, data: { gitUrl: 'https://forge.example/acme/repo.git' } });
  const prepareRequestId = `forge-prepare-${String(stamp)}`;
  const preparedForge = await enqueueInternalAction({
    workspaceId,
    op: 'stage-forge-prepare',
    target: target(gatedTicket, gatedSession),
    payload: { containerId: 'container-gated', expectedBranch: 'DEV-gated' },
    userId: 'stage-runner-test',
    clientRequestId: prepareRequestId,
  });
  const forgeIntentId = stageForgeIntentId(workspaceId, prepareRequestId);
  eq(readStageForgePrepareResult(preparedForge.result)?.intentId, forgeIntentId, 'forge prepare returns its deterministic durable intent id');
  const durableIntent = await prisma.workspaceSignal.findUnique({ where: { id: forgeIntentId }, select: { kind: true, payload: true, processedAt: true } });
  eq(durableIntent?.kind, 'stage-forge-prepare', 'forge intent exists durably before external push');
  assert(durableIntent?.processedAt !== null, 'accepted forge prepare is marked processed and becomes authorization');
  assert(JSON.stringify(durableIntent?.payload).includes(gatedSession.runToken), 'durable forge intent binds the session runToken');
  assert(JSON.stringify(durableIntent?.payload).includes(String(gatedSession.runFence)), 'durable forge intent binds the session run fence');

  let pushes = 0;
  let mrOpens = 0;
  let authorityChecks = 0;
  const externalForge = await pushTicketWork(prisma, workspaceId, gatedTicket.key, {
    ticketId: gatedTicket.id,
    projectId: gatedTicket.projectId,
    branch: 'DEV-gated',
    assertAuthority: async () => { authorityChecks += 1; },
  }, {
    push: async () => { eq(currentWriterScope(), null, 'git push runs outside writer context'); pushes += 1; },
    resolve: async () => ({ mode: 'gitlab', base: 'https://forge.example', token: 'test-token', repoPath: 'acme/repo', webhookSecret: undefined }),
    openMr: async () => { eq(currentWriterScope(), null, 'MR HTTP runs outside writer context'); mrOpens += 1; return 'https://forge.example/mr/7'; },
  });
  eq(pushes, 1, 'external forge helper pushes once through the injected boundary');
  eq(mrOpens, 1, 'external forge helper opens/finds one MR');
  eq(authorityChecks, 2, 'fenced authority is rechecked immediately before push and before MR HTTP');
  eq(externalForge.mrUrl, 'https://forge.example/mr/7', 'external forge helper returns the MR URL');
  eq((await prisma.ticket.findUnique({ where: { id: gatedTicket.id } }))?.mrUrl, null, 'external push/open-MR helper performs no Ticket mutation');

  const forgeAction = {
    workspaceId,
    op: 'stage-forge-complete' as const,
    target: target(gatedTicket, gatedSession),
    payload: { containerId: 'container-gated', intentId: forgeIntentId, expectedBranch: 'DEV-gated', mrUrl: externalForge.mrUrl ?? '' },
    userId: 'stage-runner-test',
    clientRequestId: `forge-complete-${String(stamp)}`,
  };
  const forgeFirst = await enqueueInternalAction(forgeAction);
  await enqueueInternalAction(forgeAction);
  eq(readStageForgeCompleteResult(forgeFirst.result)?.changed, true, 'first forge completion applies the MR URL');
  eq((await prisma.ticket.findUnique({ where: { id: gatedTicket.id } }))?.mrUrl, 'https://forge.example/mr/7', 'MR URL is persisted only by the writer op');

  let racedPushes = 0;
  const racedForge = await pushTicketWork(prisma, workspaceId, gatedTicket.key, {
    ticketId: gatedTicket.id,
    projectId: gatedTicket.projectId,
    branch: 'DEV-gated',
  }, {
    push: async () => { racedPushes += 1; },
    resolve: async () => {
      await prisma.ticket.update({ where: { id: gatedTicket.id }, data: { branch: 'DEV-raced' } });
      return { mode: 'gitlab', base: 'https://forge.example', token: 'test-token', repoPath: 'acme/repo', webhookSecret: undefined };
    },
    openMr: async () => 'https://forge.example/mr/raced',
  });
  eq(racedForge.error, 'forge.targetChanged', 'branch/project re-read fails closed immediately before external push');
  eq(racedPushes, 0, 'a target race performs no external push');
  await prisma.ticket.update({ where: { id: gatedTicket.id }, data: { branch: 'DEV-gated' } });

  const wrongBranchForge = await enqueueInternalAction({ ...forgeAction, payload: { ...forgeAction.payload, expectedBranch: 'DEV-other', mrUrl: 'https://forge.example/mr/8' }, clientRequestId: `forge-wrong-branch-${String(stamp)}` });
  eq(readStageForgeCompleteResult(wrongBranchForge.result)?.applied, false, 'wrong expected branch is ignored');
  const promotedTicket = await ticketAt('refined', 'forge-promoted', 'DEV-promoted');
  const promotedSession = await start(promotedTicket, 'container-promoted');
  const promotedPrepareId = `forge-promoted-prepare-${String(stamp)}`;
  const promotedPrepare = await enqueueInternalAction({
    workspaceId,
    op: 'stage-forge-prepare',
    target: target(promotedTicket, promotedSession),
    payload: { containerId: 'container-promoted', expectedBranch: 'DEV-promoted' },
    userId: 'stage-runner-test',
    clientRequestId: promotedPrepareId,
  });
  assert(stageActionPersisted(promotedPrepare.result, promotedTicket.key), 'forge intent is durable before a planned promotion');
  await prisma.ticket.update({ where: { id: promotedTicket.id }, data: { stageId: 'plan' } });
  const promotedComplete = await enqueueInternalAction({
    workspaceId,
    op: 'stage-forge-complete',
    target: target(promotedTicket, promotedSession),
    payload: {
      containerId: 'container-promoted',
      intentId: stageForgeIntentId(workspaceId, promotedPrepareId),
      expectedBranch: 'DEV-promoted',
      mrUrl: 'https://forge.example/mr/promoted',
    },
    userId: 'stage-runner-test',
    clientRequestId: `forge-promoted-complete-${String(stamp)}`,
  });
  eq(readStageForgeCompleteResult(promotedComplete.result)?.applied, true, 'matching prepared forge completion may persist after planned stage advancement');
  eq((await prisma.ticket.findUnique({ where: { id: promotedTicket.id } }))?.mrUrl, 'https://forge.example/mr/promoted', 'promoted ticket keeps the authorized MR URL');

  const rejectedAfterAdvanceId = `forge-rejected-after-advance-${String(stamp)}`;
  const rejectedAfterAdvance = await enqueueInternalAction({
    workspaceId,
    op: 'stage-forge-prepare',
    target: target(promotedTicket, promotedSession),
    payload: { containerId: 'container-promoted', expectedBranch: 'DEV-promoted' },
    userId: 'stage-runner-test',
    clientRequestId: rejectedAfterAdvanceId,
  });
  eq(readStageForgePrepareResult(rejectedAfterAdvance.result)?.applied, false, 'prepare after an unprepared stage advance is rejected');
  const rejectedAfterAdvanceComplete = await enqueueInternalAction({
    workspaceId,
    op: 'stage-forge-complete',
    target: target(promotedTicket, promotedSession),
    payload: {
      containerId: 'container-promoted',
      intentId: stageForgeIntentId(workspaceId, rejectedAfterAdvanceId),
      expectedBranch: 'DEV-promoted',
      mrUrl: 'https://forge.example/mr/rejected',
    },
    userId: 'stage-runner-test',
    clientRequestId: `forge-rejected-after-advance-complete-${String(stamp)}`,
  });
  eq(readStageForgeCompleteResult(rejectedAfterAdvanceComplete.result)?.applied, false, 'unprocessed rejected prepare cannot authorize completion after stage advancement');
  eq((await prisma.ticket.findUnique({ where: { id: promotedTicket.id } }))?.mrUrl, 'https://forge.example/mr/promoted', 'rejected prepare cannot replace the accepted MR URL');

  const forgeSuccessor = await start(gatedTicket, 'container-gated', 'forge-successor-token');
  const stalePrepare = await enqueueInternalAction({
    workspaceId,
    op: 'stage-forge-prepare',
    target: target(gatedTicket, gatedSession),
    payload: { containerId: 'container-gated', expectedBranch: 'DEV-gated' },
    userId: 'stage-runner-test',
    clientRequestId: `forge-old-prepare-${String(stamp)}`,
  });
  eq(readStageForgePrepareResult(stalePrepare.result)?.applied, false, 'old A cannot prepare external forge work after successor B owns the slot');
  const rejectedPrepareSignal = await prisma.workspaceSignal.findUnique({ where: { id: stageForgeIntentId(workspaceId, `forge-old-prepare-${String(stamp)}`) }, select: { processedAt: true } });
  eq(rejectedPrepareSignal?.processedAt, null, 'rejected forge prepare stays unprocessed and cannot authorize completion');
  const staleTokenForge = await enqueueInternalAction({ ...forgeAction, payload: { ...forgeAction.payload, mrUrl: 'https://forge.example/mr/9' }, clientRequestId: `forge-old-token-${String(stamp)}` });
  eq(readStageForgeCompleteResult(staleTokenForge.result)?.applied, false, 'old runToken cannot apply forge completion after a same-container successor starts');
  eq((await prisma.agentSession.findUnique({ where: { id: forgeSuccessor.id } }))?.runToken, 'forge-successor-token', 'the successor remains the authoritative session owner');
  eq((await prisma.ticket.findUnique({ where: { id: gatedTicket.id } }))?.mrUrl, 'https://forge.example/mr/7', 'wrong-branch/old-token completion cannot replace the MR URL');

  // Slow CI executes in the current container and returns only a bounded report. The writer derives
  // status, persists the actual reported HEAD, and terminal replay reconstructs downstream needs.
  await prisma.pipelineStage.updateMany({ where: { workspaceId, projectId: project.id, key: 'refined' }, data: { gateForApproval: false } });
  const executionCommands: string[][] = [];
  const executionReport = await runStageCiInContainer('current-ticket-container', {
    inspectContainer: async (container) => container === 'current-ticket-container',
    runDocker: async (args) => {
      executionCommands.push(args);
      if (args.includes('rev-parse')) return { code: 0, out: 'b'.repeat(40), err: '', timedOut: false, outputLimitExceeded: false };
      if (args.includes('status')) return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false };
      if (args.join(' ').includes('.workspaces/ci.yml')) {
        return {
          code: 0,
          out: 'version: 1\nstages: [test]\njobs:\n  unit:\n    stage: test\n    script: ["npm test"]',
          err: '',
          timedOut: false,
          outputLimitExceeded: false,
        };
      }
      return { code: 1, out: 'test failed', err: '', timedOut: false, outputLimitExceeded: false };
    },
  });
  eq(executionReport.commitHash, 'b'.repeat(40), 'stage CI reads actual git rev-parse HEAD from the current worktree');
  assert(executionReport.kind === 'executed' && executionReport.jobs[0]?.status === 'failed', 'stage CI returns exact bounded per-job execution facts');
  assert(executionCommands.every((args) => args.includes('current-ticket-container')), 'every stage-CI command targets the current ticket container');
  assert(executionCommands.every((args) => args[0] === 'exec'), 'stage CI never launches a branch-tip clone container');

  let headReads = 0;
  const mutatingReport = await runStageCiInContainer('current-ticket-container', {
    inspectContainer: async () => true,
    runDocker: async (args) => {
      if (args.includes('rev-parse')) {
        headReads += 1;
        return { code: 0, out: (headReads === 1 ? 'e' : 'f').repeat(40), err: '', timedOut: false, outputLimitExceeded: false };
      }
      if (args.includes('status')) return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false };
      if (args.join(' ').includes('.workspaces/ci.yml')) return { code: 0, out: 'version: 1\nstages: [test]\njobs:\n  unit:\n    stage: test\n    script: ["npm test"]', err: '', timedOut: false, outputLimitExceeded: false };
      return { code: 0, out: 'ok', err: '', timedOut: false, outputLimitExceeded: false };
    },
  });
  assert(mutatingReport.kind === 'executed' && mutatingReport.integrityError === 'ci.headChanged', 'a CI job that changes HEAD forces an integrity failure');
  eq(mutatingReport.commitHash, 'e'.repeat(40), 'mutating CI report remains pinned to the actual pre-run HEAD');

  let dirtyJobExecutions = 0;
  const dirtyReport = await runStageCiInContainer('current-ticket-container', {
    inspectContainer: async () => true,
    runDocker: async (args) => {
      if (args.includes('rev-parse')) return { code: 0, out: '9'.repeat(40), err: '', timedOut: false, outputLimitExceeded: false };
      if (args.includes('status')) return { code: 0, out: '?? untracked.txt', err: '', timedOut: false, outputLimitExceeded: false };
      if (args.join(' ').includes('.workspaces/ci.yml')) return { code: 0, out: 'version: 1\nstages: [test]\njobs:\n  unit:\n    stage: test\n    script: ["npm test"]', err: '', timedOut: false, outputLimitExceeded: false };
      dirtyJobExecutions += 1;
      return { code: 0, out: '', err: '', timedOut: false, outputLimitExceeded: false };
    },
  });
  assert(dirtyReport.kind === 'executed' && dirtyReport.integrityError === 'ci.worktreeDirtyBefore', 'tracked/untracked dirt before CI forces failure');
  eq(dirtyJobExecutions, 0, 'dirty preflight runs no CI job command');

  const ciTicket = await ticketAt('test', 'ci-fail');
  await prisma.ticket.update({ where: { id: ciTicket.id }, data: { commitHash: 'baseline-must-not-be-stored' } });
  const ciSession = await start(ciTicket, 'container-ci');
  const actualReportHash = 'a'.repeat(40);
  const injectedReport: StageCiReport = {
    kind: 'executed',
    commitHash: actualReportHash,
    spec: {
      version: 1,
      stages: ['test'],
      jobs: [{ name: 'unit', stage: 'test', type: 'script', script: ['npm test'], needs: [], image: 'project', allowFailure: false }],
    },
    jobs: [{ name: 'unit', status: 'failed', exitCode: 1, severity: 'none', findings: [], logTail: 'one bounded failure' }],
  };
  let ciBoundaryCalls = 0;
  const fakeCiBoundary = async (container: string): Promise<StageCiReport> => {
    eq(currentWriterScope(), null, 'slow CI boundary runs outside writer context');
    eq(container, 'container-ci', 'stage CI receives the current ticket container, not a branch clone request');
    ciBoundaryCalls += 1;
    return injectedReport;
  };
  const ciVerdict = await runStageCiOutsideWriter('container-ci', fakeCiBoundary);
  eq(ciBoundaryCalls, 1, 'fake current-worktree CI boundary executes once without Docker');
  const [leasedCiError] = await tryCatch(() => runInWriterContext(workspaceId, () => runStageCiOutsideWriter('container-ci', fakeCiBoundary)));
  assert(leasedCiError !== null && leasedCiError.message.includes('cannot run under the workspace writer'), 'slow CI boundary fails closed under writer context');
  const ciAction = completion(
    ciTicket,
    ciSession,
    'container-ci',
    { kind: 'done', envelope: { summary: 'tests ran', changedFiles: [], openQuestions: [] } },
    `ci-fail-${String(stamp)}`,
    ciVerdict,
  );

  const invalidStatusAction = {
    ...ciAction,
    payload: {
      ...ciAction.payload,
      ci: {
        ...injectedReport,
        jobs: [{ ...injectedReport.jobs[0], status: 'green' }],
      },
    },
  };
  const [invalidStatusError] = await tryCatch(() => Promise.resolve(assertValidInternalAction(invalidStatusAction)));
  assert(invalidStatusError !== null && invalidStatusError.message.includes('invalid stage CI report'), 'an injected unknown job status is rejected at the InternalOp boundary');
  const [freeStatusError] = await tryCatch(() => Promise.resolve(assertValidInternalAction({
    ...ciAction,
    payload: { ...ciAction.payload, ci: { ...injectedReport, status: 'failed', runId: 'untrusted-run' } },
  })));
  assert(freeStatusError !== null && freeStatusError.message.includes('invalid stage CI report'), 'free top-level status/runId fields are rejected instead of trusted');
  const [statusExitMismatch] = await tryCatch(() => Promise.resolve(assertValidInternalAction({
    ...ciAction,
    payload: { ...ciAction.payload, ci: { ...injectedReport, jobs: [{ ...injectedReport.jobs[0], status: 'success' }] } },
  })));
  assert(statusExitMismatch !== null, 'status success with exitCode 1 is rejected');
  const [jobAllowFailureInjection] = await tryCatch(() => Promise.resolve(assertValidInternalAction({
    ...ciAction,
    payload: { ...ciAction.payload, ci: { ...injectedReport, jobs: [{ ...injectedReport.jobs[0], allowFailure: true }] } },
  })));
  assert(jobAllowFailureInjection !== null, 'job-result allowFailure cannot override the immutable spec bit');
  const scannerReport: StageCiReport = {
    kind: 'executed',
    commitHash: actualReportHash,
    spec: { version: 1, stages: ['scan'], jobs: [{ name: 'deps', stage: 'scan', type: 'dep-audit', script: [], needs: [], image: 'project', allowFailure: true }] },
    jobs: [{ name: 'deps', status: 'success', exitCode: 0, severity: 'none', findings: [{ id: 'dep:x', severity: 'critical', title: 'critical dependency' }], logTail: '1 finding' }],
  };
  const [lowerScannerSeverity] = await tryCatch(() => Promise.resolve(assertValidInternalAction({ ...ciAction, payload: { ...ciAction.payload, ci: scannerReport } })));
  assert(lowerScannerSeverity !== null, 'scanner severity lower than its bounded findings is rejected');

  //? Per-service CI: `serviceId: null` = the project root unit, written EXPLICITLY. On MongoDB an omitted
  //? field is absent, absent does not match the runner's `serviceId: null` lookup, and the unique index
  //? treats absent and null as the same value — so omitting it both hides this row from the lookup AND
  //? collides with the row that lookup then creates. The ids are unit-salted for the same reason: two
  //? units under one clientRequestId would otherwise derive identical run/job ids.
  const partialPipeline = await prisma.pipeline.create({
    data: { workspaceId, projectId: project.id, serviceId: null, specHash: 'partial', stages: ['test'], runnerKind: 'builtin' },
  });
  const partialRunId = deterministicObjectId(workspaceId, ciAction.clientRequestId, 'ci-run:root');
  await prisma.pipelineRun.create({
    data: {
      id: partialRunId,
      workspaceId,
      pipelineId: partialPipeline.id,
      projectId: project.id,
      serviceId: null,
      ticketId: ciTicket.id,
      commitHash: actualReportHash,
      trigger: 'test-stage',
      status: 'running',
    },
  });
  await prisma.pipelineJob.create({
    data: {
      id: deterministicObjectId(workspaceId, ciAction.clientRequestId, 'ci-job:root:0:unit'),
      workspaceId,
      pipelineRunId: partialRunId,
      name: 'unit',
      stage: 'test',
      jobType: 'script',
      needs: [],
      script: ['npm test'],
      imageRef: 'project',
      status: 'pending',
      allowFailure: false,
    },
  });
  await prisma.ticketEvent.create({
    data: {
      id: deterministicObjectId(workspaceId, ciAction.clientRequestId, 'ci-event:root:0:unit'),
      workspaceId,
      ticketId: ciTicket.id,
      seq: 1,
      type: 'ci',
      actor: 'conductor',
      text: 'partial CI event',
    },
  });
  await prisma.spendRecord.create({
    data: {
      id: deterministicObjectId(workspaceId, ciAction.clientRequestId, 'stage-spend'),
      workspaceId,
      userId: owner.id,
      ticketId: ciTicket.id,
      stageId: 'test',
      sessionKey: `worker:${ciTicket.id}:test`,
      tokensIn: 10,
      tokensOut: 5,
      model: 'sonnet',
      costEstimate: 0,
      providerId: 'claude-cli',
      feature: 'pipeline-agent',
    },
  });
  await prisma.carryOver.create({
    data: {
      id: deterministicObjectId(workspaceId, ciAction.clientRequestId, 'stage-carry-over'),
      workspaceId,
      ticketId: ciTicket.id,
      fromStageId: 'test',
      toStageId: 'review',
      sessionId: ciSession.id,
      envelope: { summary: 'tests ran', changedFiles: [], openQuestions: [] },
    },
  });

  const [outsideWriterError] = await tryCatch(() => applyStageTurnComplete(prisma, workspaceId, ciAction));
  assert(outsideWriterError !== null && outsideWriterError.message.includes('no active Conductor writer context'), 'stage mutation helper rejects calls outside writer context');
  const firstCiApply = await enqueueInternalAction(ciAction);
  const ciResult = readStageTurnCompleteResult(firstCiApply.result);
  eq(ciResult?.ciBlocked, true, 'writer-derived required-job failure blocks advancement');
  const replayedCiApply = await enqueueInternalAction(ciAction);
  assert(stageActionPersisted(replayedCiApply.result, ciTicket.key), 'terminal replay keys prove the stage result was persisted');
  const replayOutcome = await resolveStageTurnWriterOutcome(prisma, workspaceId, ciAction, replayedCiApply.result);
  eq(replayOutcome.keys, [ciTicket.key], 'terminal replay preserves the ticket key needed for broadcast');
  eq(replayOutcome.completion?.ciBlocked, true, 'terminal replay re-reads the persisted CI gate decision');
  const ciTicketAfter = await prisma.ticket.findUnique({ where: { id: ciTicket.id }, select: { stageId: true, status: true, needsInput: true } });
  eq(ciTicketAfter?.stageId, 'test', 'CI-red ticket stays on the test stage');
  eq(ciTicketAfter?.status, 'needs-input', 'CI-red ticket parks for repair');
  assert((ciTicketAfter?.needsInput ?? '').startsWith('CI failed'), 'CI-red reason is surfaced');
  const persistedRun = await prisma.pipelineRun.findFirst({ where: { workspaceId, ticketId: ciTicket.id, trigger: 'test-stage' }, orderBy: { startedAt: 'desc' } });
  eq(persistedRun?.commitHash, actualReportHash, 'PipelineRun stores the actual git HEAD from the execution report, not Ticket.commitHash');
  eq(persistedRun?.status, 'failed', 'the writer derives the run status from exact job facts + allowFailure');
  eq((await prisma.pipelineJob.findFirst({ where: { workspaceId, pipelineRunId: persistedRun?.id ?? '' } }))?.allowFailure, false, 'the persisted job keeps the spec allowFailure contract');
  eq(await prisma.pipelineRun.count({ where: { workspaceId, ticketId: ciTicket.id, trigger: 'test-stage' } }), 1, 'partial-preseeded PipelineRun converges without duplicate');
  eq(await prisma.pipelineJob.count({ where: { workspaceId, pipelineRunId: partialRunId } }), 1, 'partial-preseeded PipelineJob converges without duplicate');
  eq(await prisma.spendRecord.count({ where: { ticketId: ciTicket.id } }), 1, 'partial-preseeded SpendRecord converges without duplicate');
  eq(await prisma.carryOver.count({ where: { ticketId: ciTicket.id } }), 1, 'partial-preseeded CarryOver converges without duplicate');
  eq(await prisma.ticketEvent.count({ where: { ticketId: ciTicket.id, type: 'ci' } }), 2, 'partial CI event plus deterministic rollup converge to one event each');

  // Capacity drain skips an archived queue head and continues to the next live ticket.
  const queuedArchived = await ticketAt('refined', 'queued-archived', 'DEV-queued-archived');
  await prisma.ticket.update({ where: { id: queuedArchived.id }, data: { archived: true } });
  const queuedLive = await ticketAt('refined', 'queued-live', 'DEV-queued-live');
  await capacity.enqueueDeferred({ workspaceId, key: queuedArchived.key, stageId: queuedArchived.stageId });
  await capacity.enqueueDeferred({ workspaceId, key: queuedLive.key, stageId: queuedLive.stageId });
  const provisioned: string[] = [];
  await drainCapacityQueue({
    inFlight: async () => ({}),
    provision: async (_workspaceId, activated) => { provisioned.push(...activated.map((entry) => entry.key)); },
  });
  eq(provisioned, [queuedLive.key], 'archived queued item is discarded and the live successor is provisioned');
  eq(await capacity.queueLength(), 0, 'drain removes both archived head and launched live successor from the queue');
});

if (runError) assert(false, `unexpected stage-writer error: ${runError.message}`);
if (capacityMembers.length > 0) await redis.zrem(capacityActiveKey, ...capacityMembers);
if (capacityIdentities.length > 0) await redis.hdel(capacityOwnerKey, ...capacityIdentities);
if (capacityHeartbeatKeys.length > 0) await redis.del(...capacityHeartbeatKeys);
if (foreignWorkspaceId) await cleanupWorkspace(prisma, foreignWorkspaceId);
if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
else await prisma.user.deleteMany({ where: { id: owner.id } });

report('tests/integration/stageWriter.test.mts');
