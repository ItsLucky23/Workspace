//? Integration test for C1 (built-in CI quality gates, ADR 0039). Runs against the REAL Conductor + Mongo.
//? Asserts the ci.yml parser (pure), the merge gate (`ciGateForMr`: red/stale blocks, green passes, no-run
//? opens), the Admin override, the project green-CI gate, and that a failed CI run blocks a prod promote.
//? The actual job execution is a live Docker path — here we force PipelineRun states to drive the gates.

import type { StageCiReport } from '../../server/ci/runner';
import { redis } from '@luckystack/core';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction, isControlActionFailure } = await import('../../server/orchestrator/conductor');
const { enqueueInternalAction } = await import('../../server/orchestrator/internalOps');
const { dispatchControlSync } = await import('../../server/control/dispatchSync');
const { currentWriterScope } = await import('../../server/orchestrator/writerContext');
const { dispatchPublicCiRun } = await import('../../src/workspaces/_sync/projectAdmin_server_v1');
const { parseCiYaml } = await import('../../server/ci/parse');
const { runPublicCiAtCommit } = await import('../../server/ci/runner');
const { ciPublicIntentId, ciPublicIntentSignalId, deterministicObjectId } = await import('../../server/orchestrator/actionIds');
const {
  abandonCiExternalExecution,
  ciExternalClaimKey,
  claimCiExternalExecution,
  readCiExternalExecutionState,
} = await import('../../server/ci/externalClaim');
const capacity = await import('../../server/orchestrator/capacity');
const { ciGateForMr, ciGreenForProject, allowMergeOnRedCI } = await import('../../server/ci/gate');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

// ---- pure parser (no DB) --------------------------------------------------------------------------
const good = parseCiYaml(`version: 1
stages: [lint, test]
jobs:
  lint:
    stage: lint
    script: ["npm run lint"]
  unit:
    stage: test
    script: ["npm test"]
    needs: [lint]`);
assert(good.ok, 'parseCiYaml accepts a valid config');
eq(good.ok ? good.spec.jobs.length : 0, 2, 'parseCiYaml extracts both jobs');
eq(good.ok ? good.spec.jobs[1]?.needs : [], ['lint'], 'parseCiYaml reads the needs DAG edge');
assert(!parseCiYaml('').ok, 'parseCiYaml rejects an empty config');
assert(!parseCiYaml('version: 1\nstages: [x]').ok, 'parseCiYaml rejects a config with no jobs');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ci-test-${String(stamp)}@youcomm.nl`, name: 'CI Test' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CI Test WS' }, userId: owner.id, clientRequestId: `ci-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const proj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));
  const projId = proj?.id ?? '';
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'CI Ticket' }, userId: owner.id, clientRequestId: `ci-t-${String(stamp)}` });
  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'CI Ticket' } }));
  const ticketId = ticket?.id ?? '';

  //? A synthetic MR + pipeline run to drive the gate (no git/docker needed).
  const mr = await prisma.mergeRequest.create({ data: { workspaceId: wsId, projectId: projId, ticketId, number: 1, title: 'CI MR', sourceBranch: ticket?.key ?? 'DEV-1', targetBranch: 'main', status: 'open', headSha: 'abc123', mergeStrategy: 'merge' } });
  //? Per-service CI: `serviceId: null` means "the project root unit" and must be written EXPLICITLY. On
  //? MongoDB an omitted field is absent, absent does not match a `serviceId: null` lookup, and the unique
  //? index treats absent and null as the same value — so an omitted one here both hides from the runner's
  //? own lookup AND collides with the row it then tries to create.
  const pipeline = await prisma.pipeline.create({ data: { workspaceId: wsId, projectId: projId, serviceId: null, specHash: 'x', stages: ['test'], runnerKind: 'builtin' } });
  const run = await prisma.pipelineRun.create({ data: { workspaceId: wsId, pipelineId: pipeline.id, projectId: projId, serviceId: null, mergeRequestId: mr.id, commitHash: 'abc123', trigger: 'manual', status: 'failed' } });

  // ---- merge gate: red run for the current head blocks --------------------------------------------
  const redGate = await ciGateForMr(prisma, wsId, mr.id, 'abc123');
  assert(redGate.gated && redGate.reason === 'ci-red', 'a failed CI run for the current head gates the merge (ci-red)');

  // ---- green run passes ---------------------------------------------------------------------------
  await prisma.pipelineRun.updateMany({ where: { id: run.id }, data: { status: 'success' } });
  const greenGate = await ciGateForMr(prisma, wsId, mr.id, 'abc123');
  assert(!greenGate.gated, 'a green CI run does not gate the merge');

  // ---- stale head (branch advanced past the run's commit) gates ----------------------------------
  const staleGate = await ciGateForMr(prisma, wsId, mr.id, 'newhead999');
  assert(staleGate.gated && staleGate.reason === 'ci-stale', 'a green run for an OLD head does not pass (stale)');

  // ---- Admin override via the ci-allow-red op ----------------------------------------------------
  await prisma.pipelineRun.updateMany({ where: { id: run.id }, data: { status: 'failed' } });
  eq(await allowMergeOnRedCI(prisma, wsId), false, 'the override is off by default');
  await enqueueControlAction({ workspaceId: wsId, op: 'ci-allow-red', target: {}, payload: { enabled: true }, userId: owner.id, clientRequestId: `ci-ov-${String(stamp)}` });
  eq(await allowMergeOnRedCI(prisma, wsId), true, 'ci-allow-red turns the Admin override on');

  // ---- project green-CI gate + prod promote block ------------------------------------------------
  eq(await ciGreenForProject(prisma, wsId, projId), false, 'ciGreenForProject is false when the latest run failed');
  //? Force a live staging env, then a prod promote (approved) must be blocked by the red CI.
  const stagingId = await poll(async () => {
    await enqueueControlAction({ workspaceId: wsId, op: 'env-deploy', target: { projectId: projId }, payload: { kind: 'staging' }, userId: owner.id, clientRequestId: `ci-sd-${String(stamp)}-${String(Date.now())}` });
    const s = await prisma.environment.findFirst({ where: { workspaceId: wsId, projectId: projId, kind: 'staging' } });
    return s?.id ?? null;
  });
  await prisma.environment.updateMany({ where: { id: stagingId ?? '' }, data: { status: 'live', imageRef: 'img:1' } });
  const { result: promoteRes } = await enqueueControlAction({ workspaceId: wsId, op: 'env-promote', target: { projectId: projId }, payload: { fromKind: 'staging', approved: true }, userId: owner.id, clientRequestId: `ci-pp-${String(stamp)}` });
  eq((promoteRes as Record<string, unknown> | null)?.error, 'promote.needsGreenCi', 'a red CI blocks the prod promote (fills the B2 hook)');

  // ---- public ci-run: RBAC → immutable execution outside lease → bounded report persist ----------
  const publicCommit = 'd'.repeat(40);
  await prisma.ticket.update({ where: { id: ticketId }, data: { branch: ticket?.key ?? 'DEV-1' } });
  await prisma.mergeRequest.update({ where: { id: mr.id }, data: { headSha: publicCommit } });
  const publicTarget = {
    workspaceId: wsId,
    ticketId,
    ticketKey: ticket?.key ?? 'DEV-1',
    projectId: projId,
    branch: ticket?.key ?? 'DEV-1',
    commitHash: publicCommit,
    mergeRequestId: mr.id,
  };
  const publicReport: StageCiReport = {
    kind: 'executed',
    commitHash: publicCommit,
    spec: { version: 1, stages: ['test'], jobs: [{ name: 'unit', stage: 'test', type: 'script', script: ['npm test'], needs: [], image: 'project', allowFailure: false }] },
    jobs: [{ name: 'unit', status: 'success', exitCode: 0, severity: 'none', findings: [], logTail: 'green' }],
  };
  let launchedIdentity: { projectId: string; ref: string; intentId: string } | undefined;
  let safeCleanupCalls = 0;
  const runnerReport = await runPublicCiAtCommit({
    workspaceId: wsId,
    projectId: projId,
    ticketKey: publicTarget.ticketKey,
    branch: publicTarget.branch,
    commitHash: publicCommit,
    intentId: 'server-random-intent',
  }, {
    launch: async (args) => {
      launchedIdentity = args.executionIdentity;
      return { containerId: 'ci-container', name: 'ci-container', volume: 'ci-volume', created: true };
    },
    executeCurrent: async () => publicReport,
    ownsContainer: async (_name, identity) => identity.intentId === 'server-random-intent',
    teardown: async () => { safeCleanupCalls += 1; },
  });
  eq(runnerReport.commitHash, publicCommit, 'public CI runner returns the report for its exact immutable commit');
  eq(launchedIdentity, { projectId: projId, ref: publicCommit, intentId: 'server-random-intent' }, 'CI container identity labels bind project + ref + server intent');
  eq(safeCleanupCalls, 1, 'public CI cleanup runs only after exact identity ownership succeeds');

  //? Per-service CI sends a UNIT-scoped clientRequestId (`<requestId>:<unit>`), and the Conductor derives
  //? the intent/signal ids from whatever request id it receives. This mock stands in for the Conductor, so
  //? it has to derive them the same way — deriving from the bare request id makes the real dispatcher
  //? reject its own prepared intent, which presents as a hang rather than an error.
  const unitScoped = (requestId: string) => `${requestId}:root`;
  const fakePrepared = (requestId: string) => ({
    intent: {
      id: ciPublicIntentId(wsId, projId, unitScoped(requestId)),
      signalId: ciPublicIntentSignalId(wsId, unitScoped(requestId)),
      ...publicTarget,
      trigger: 'manual',
    },
  });
  const fakeComplete = async () => ({ signalSeq: 1, result: { applied: true, keys: [publicTarget.ticketKey] } });

  let unblockExecution: (() => void) | null = null;
  let executionStarted: (() => void) | null = null;
  let blockedExecutions = 0;
  const blockedRequestId = `ci-blocked-${String(stamp)}`;
  const started = new Promise<void>((resolve) => { executionStarted = resolve; });
  const blocked = new Promise<void>((resolve) => { unblockExecution = resolve; });
  const blockedDependencies = {
    authorize: async () => true,
    resolve: async () => publicTarget,
    execute: async () => {
      eq(currentWriterScope(), null, 'blocked public CI execution has no writer/lease context');
      blockedExecutions += 1;
      executionStarted?.();
      await blocked;
      return publicReport;
    },
    currentHead: async () => publicCommit,
    dispatch: async () => ({ ok: true as const, result: fakePrepared(blockedRequestId) }),
    complete: fakeComplete,
    broadcast: async () => undefined,
  };
  const blockedInput = {
    prisma,
    workspaceId: wsId,
    userId: owner.id,
    projectId: projId,
    ticketKey: publicTarget.ticketKey,
    trigger: 'manual',
    clientRequestId: blockedRequestId,
  };
  const blockedRun = dispatchPublicCiRun(blockedInput, blockedDependencies);
  await started;
  const pendingDuplicate = await dispatchPublicCiRun(blockedInput, blockedDependencies);
  assert(!pendingDuplicate.ok && pendingDuplicate.errorCode === 'ci.pending', 'duplicate pending public CI returns an explicit pending error, never success');
  eq(blockedExecutions, 1, 'pending duplicate starts no second external execution');
  const whileBlocked = await enqueueControlAction({
    workspaceId: wsId,
    op: 'ci-allow-red',
    target: {},
    payload: { enabled: false },
    userId: owner.id,
    clientRequestId: `ci-while-blocked-${String(stamp)}`,
  });
  assert(!isControlActionFailure(whileBlocked.result), 'another writer action completes while fake CI execution is blocked');
  unblockExecution?.();
  assert((await blockedRun).ok, 'blocked fake execution resumes and dispatches');
  eq(await readCiExternalExecutionState(ciPublicIntentId(wsId, projId, unitScoped(blockedRequestId))), 'success', 'external claim becomes terminal success only after ci-public-complete');

  // A crashed pending owner is not terminal: its TTL permits a successor retry.
  const crashIntent = ciPublicIntentId(wsId, projId, `ci-crash-${String(stamp)}`);
  const crashedClaim = await claimCiExternalExecution(crashIntent, 80);
  assert(crashedClaim.state === 'claimed', 'first process claims the external CI intent');
  eq((await claimCiExternalExecution(crashIntent, 80)).state, 'pending', 'a live pending owner blocks duplicates');
  await wait(120);
  const retryClaim = await claimCiExternalExecution(crashIntent, 80);
  assert(retryClaim.state === 'claimed', 'expired crash claim permits a retry');
  if (retryClaim.state === 'claimed') await abandonCiExternalExecution(retryClaim.claim);
  await redis.del(ciExternalClaimKey(crashIntent));

  let deniedExecutions = 0;
  const deniedPublic = await dispatchPublicCiRun({
    prisma,
    workspaceId: wsId,
    userId: owner.id,
    projectId: projId,
    ticketKey: publicTarget.ticketKey,
    trigger: 'manual',
    clientRequestId: `ci-denied-${String(stamp)}`,
  }, {
    authorize: async () => false,
    resolve: async () => publicTarget,
    execute: async () => { deniedExecutions += 1; return publicReport; },
    currentHead: async () => publicCommit,
    dispatch: async () => ({ ok: true, result: fakePrepared(`ci-denied-${String(stamp)}`) }),
    complete: fakeComplete,
    broadcast: async () => undefined,
  });
  assert(!deniedPublic.ok && deniedPublic.errorCode === 'auth.forbidden', 'public CI fails RBAC before execution');
  eq(deniedExecutions, 0, 'failed RBAC performs no fake external execution');

  const missingReport = await enqueueControlAction({
    workspaceId: wsId,
    op: 'ci-run',
    target: { ticketId: publicTarget.ticketKey, projectId: projId },
    payload: {},
    userId: owner.id,
    clientRequestId: `ci-no-report-${String(stamp)}`,
  });
  assert(isControlActionFailure(missingReport.result), 'direct ci-run without a server execution report cannot succeed');
  const malformedReport = await enqueueControlAction({
    workspaceId: wsId,
    op: 'ci-run',
    target: { ticketId: publicTarget.ticketKey, projectId: projId },
    payload: {
      report: { ...publicReport, jobs: [{ ...publicReport.jobs[0], status: 'success', exitCode: 1 }] },
      binding: { ticketId, branch: publicTarget.branch, commitHash: publicCommit, mergeRequestId: mr.id, trigger: 'manual' },
    },
    userId: owner.id,
    clientRequestId: `ci-malformed-${String(stamp)}`,
  });
  assert(isControlActionFailure(malformedReport.result), 'Conductor rejects a malformed/inconsistent public CI report');

  let broadcasts = 0;
  let publicExecutions = 0;
  let publicIntentId = '';
  const publicRequestId = `ci-public-${String(stamp)}`;
  const publicResult = await dispatchPublicCiRun({
    prisma,
    workspaceId: wsId,
    userId: owner.id,
    projectId: projId,
    ticketKey: publicTarget.ticketKey,
    trigger: 'manual',
    clientRequestId: publicRequestId,
  }, {
    authorize: async () => true,
    resolve: async () => publicTarget,
    execute: async (intent) => {
      eq(currentWriterScope(), null, 'public CI report executes outside writer context');
      publicExecutions += 1;
      publicIntentId = intent.id;
      return publicReport;
    },
    currentHead: async () => publicCommit,
    dispatch: dispatchControlSync,
    complete: enqueueInternalAction,
    broadcast: async (_prisma, _workspaceId, keys) => { eq(keys, [publicTarget.ticketKey], 'public CI broadcasts its ticket key'); broadcasts += 1; },
  });
  assert(publicResult.ok, 'authorized public CI report persists through the Conductor');
  eq(publicIntentId, ciPublicIntentId(wsId, projId, unitScoped(publicRequestId)), 'public CI intent is deterministic from workspace + project + the unit-scoped clientRequestId');
  eq(await readCiExternalExecutionState(publicIntentId), 'success', 'final external state is success after durable completion');
  eq(broadcasts, 1, 'public CI broadcasts after persistence');
  //? The run id is salted with the UNIT ('root' = the project root). Without that salt, two services
  //? running under one clientRequestId — which is exactly what a fan-out CI run does — derive the same run
  //? id and the second silently overwrites the first's results.
  const publicRunId = deterministicObjectId(wsId, `ci-public:${publicIntentId}`, 'ci-run:root');
  eq((await prisma.pipelineRun.findUnique({ where: { id: publicRunId } }))?.commitHash, publicCommit, 'public PipelineRun stores the immutable executed commit');
  eq((await prisma.pipelineRun.findUnique({ where: { id: publicRunId } }))?.status, 'success', 'public PipelineRun status is writer-derived from job facts');

  const duplicatePublic = await dispatchPublicCiRun({
    prisma,
    workspaceId: wsId,
    userId: owner.id,
    projectId: projId,
    ticketKey: publicTarget.ticketKey,
    trigger: 'manual',
    clientRequestId: publicRequestId,
  }, {
    authorize: async () => true,
    resolve: async () => publicTarget,
    execute: async () => { publicExecutions += 1; return publicReport; },
    currentHead: async () => publicCommit,
    dispatch: dispatchControlSync,
    complete: enqueueInternalAction,
    broadcast: async () => { broadcasts += 1; },
  });
  assert(duplicatePublic.ok, 'duplicate public CI prepare replays successfully');
  eq(publicExecutions, 1, 'duplicate prepare replay receives no executable intent and never runs Docker again');
  eq(broadcasts, 2, 'terminal public CI replay re-broadcasts to heal a crash between persistence and delivery');
  eq(await prisma.pipelineRun.count({ where: { id: publicRunId } }), 1, 'final completion is idempotent and materializes one PipelineRun');

  // ---- public CI shares the one global CapacityManager budget -------------------------------
  const capacityLimit = capacity.capacityLimit();
  let capacityExecutions = 0;
  let releaseCapacityRuns: (() => void) | null = null;
  const capacityBlocked = new Promise<void>((resolve) => { releaseCapacityRuns = resolve; });
  const capacityInput = (index: number) => ({
    prisma,
    workspaceId: wsId,
    userId: owner.id,
    projectId: projId,
    ticketKey: publicTarget.ticketKey,
    trigger: 'manual',
    clientRequestId: `ci-capacity-${String(stamp)}-${String(index)}`,
  });
  const capacityDependencies = (requestId: string) => ({
    authorize: async () => true,
    resolve: async () => publicTarget,
    execute: async () => { capacityExecutions += 1; await capacityBlocked; return publicReport; },
    currentHead: async () => publicCommit,
    dispatch: async () => ({ ok: true as const, result: fakePrepared(requestId) }),
    complete: fakeComplete,
    broadcast: async () => undefined,
  });
  const capacityRuns = Array.from({ length: capacityLimit }, (_, index) => {
    const request = capacityInput(index);
    return dispatchPublicCiRun(request, capacityDependencies(request.clientRequestId));
  });
  assert(await poll(async () => capacityExecutions === capacityLimit ? true : null) === true, 'parallel public CI fills the shared host cap and no more');
  const overflowRequest = capacityInput(capacityLimit);
  const overflow = await dispatchPublicCiRun(overflowRequest, capacityDependencies(overflowRequest.clientRequestId));
  assert(!overflow.ok && overflow.errorCode === 'capacity.unavailable', 'no global slot returns an explicit capacity error');
  eq(capacityExecutions, capacityLimit, 'capacity rejection launches no external execution/container');
  eq(await capacity.activeCount(Date.now()), capacityLimit, 'unique CI intent IDs cannot exceed the shared host cap');
  releaseCapacityRuns?.();
  const capacityResults = await Promise.all(capacityRuns);
  assert(capacityResults.every((result) => result.ok), 'all admitted public CI executions finish after release');
  eq(await capacity.activeCount(Date.now()), 0, 'every admitted public CI reservation releases owner-safely');

  // ---- manual no-MR freshness: branch advances during execution → canceled, never green ----------
  const manualTicket = await prisma.ticket.create({
    data: {
      workspaceId: wsId,
      projectId: projId,
      key: `DEV-CI-STALE-${String(stamp)}`,
      number: 990001,
      title: 'Manual stale CI',
      stageId: 'unrefined',
      status: 'idle',
      branch: 'manual-ci-branch',
      labels: [],
      priority: 'normal',
    },
  });
  const staleCommit = '6'.repeat(40);
  const advancedCommit = '7'.repeat(40);
  const staleTarget = {
    workspaceId: wsId,
    ticketId: manualTicket.id,
    ticketKey: manualTicket.key,
    projectId: projId,
    branch: 'manual-ci-branch',
    commitHash: staleCommit,
    mergeRequestId: null,
  };
  const staleReport: StageCiReport = { ...publicReport, commitHash: staleCommit };
  const stalePublic = await dispatchPublicCiRun({
    prisma,
    workspaceId: wsId,
    userId: owner.id,
    projectId: projId,
    ticketKey: manualTicket.key,
    trigger: 'manual',
    clientRequestId: `ci-public-stale-${String(stamp)}`,
  }, {
    authorize: async () => true,
    resolve: async () => staleTarget,
    execute: async () => staleReport,
    currentHead: async () => advancedCommit,
    dispatch: dispatchControlSync,
    complete: enqueueInternalAction,
    broadcast: async () => undefined,
  });
  assert(stalePublic.ok, 'stale manual CI completes as a durable canceled result');
  const staleRun = await prisma.pipelineRun.findFirst({ where: { workspaceId: wsId, ticketId: manualTicket.id }, orderBy: { startedAt: 'desc' } });
  eq(staleRun?.status, 'canceled', 'manual CI whose branch advanced is persisted canceled, never success');
  eq(await ciGreenForProject(prisma, wsId, projId, advancedCommit), false, 'a canceled stale run cannot make the current source revision green');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/ciGate.test.mts');
