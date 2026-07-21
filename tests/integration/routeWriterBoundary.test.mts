//? Legacy typed-route migration seam: account writes enter the global Conductor scope; workspace writes enter
//? tenant scope under the workspace writer/lease and append a processed durable signal. No HTTP server needed.

import { tryCatchSync } from '@luckystack/core';
import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';
import { currentWorkspaceId } from '../../server/tenant/tenantContext.ts';
import { currentWriterScope, GLOBAL_WRITER_SCOPE } from '../../server/orchestrator/writerContext.ts';
import { enqueueInternalAction, internalActionFromSignal, type RuntimeLaunchPrepareInternalAction } from '../../server/orchestrator/internalOps.ts';
import { runtimeLaunchCompletionId, runtimeLaunchIntentId } from '../../server/orchestrator/actionIds.ts';

const prisma = await db();
const { runPreparedRuntimeLaunch, runRuntimeJobRecovery } = await import('../../server/orchestrator/runtimeJobs.ts');
const { enqueueGlobalRouteWrite, enqueueWorkspaceRouteWrite, runRouteJobRecovery } = await import('../../server/orchestrator/conductor.ts');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace.ts');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `route-writer-${String(stamp)}@example.com`, name: 'Route writer' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Route writer boundary');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  const globalScope = await enqueueGlobalRouteWrite(
    { kind: 'test-account-write', userId: owner.id, clientRequestId: `global-${String(stamp)}` },
    async () => currentWriterScope(),
  );
  eq(globalScope, GLOBAL_WRITER_SCOPE, 'account route writes execute inside the global Conductor scope');
  eq(currentWriterScope(), null, 'global writer context does not leak after completion');

  const observed = await enqueueWorkspaceRouteWrite(
    wsId,
    { kind: 'test-workspace-write', userId: owner.id, clientRequestId: `workspace-${String(stamp)}` },
    async () => {
      const writerScope = currentWriterScope();
      const tenantScope = currentWorkspaceId();
      const note = await prisma.workspaceNote.create({ data: { workspaceId: wsId, authorKind: 'user', authorId: owner.id, body: 'written by route seam' } });
      return { writerScope, tenantScope, noteId: note.id };
    },
  );
  eq(observed.writerScope, wsId, 'workspace route writes execute inside the matching writer scope');
  eq(observed.tenantScope, wsId, 'workspace route writes execute inside runInTenant');
  assert(await prisma.workspaceNote.findFirst({ where: { workspaceId: wsId, id: observed.noteId } }) !== null, 'the authoritative write persisted');

  const signal = await prisma.workspaceSignal.findFirst({ where: { workspaceId: wsId, kind: 'route.test-workspace-write' }, orderBy: { seq: 'desc' } });
  assert(signal !== null, 'workspace route write appends a durable signal');
  assert(signal?.processedAt instanceof Date, 'the signal is marked processed only after the write completes');
  eq(currentWriterScope(), null, 'workspace writer context does not leak after completion');

  const project = await prisma.project.findFirst({ where: { workspaceId: wsId }, select: { id: true } });
  assert(project !== null, 'the fixture has a project for completion replay');
  const replayRequestId = `project-image-replay-${String(stamp)}`;
  const replaySignal = await prisma.workspaceSignal.create({
    data: {
      workspaceId: wsId,
      seq: 900_000 + (stamp % 10_000),
      kind: 'project-image-complete',
      payload: {
        op: 'project-image-complete', userId: owner.id, clientRequestId: replayRequestId, version: 1,
        target: { projectId: project?.id ?? '' }, payload: { tag: 'workspaces/recovered:test' },
      },
      createdAt: new Date(Date.now() - 60_000),
    },
  });
  assert(replaySignal.createdAt.getTime() <= Date.now() - 30_000, 'the simulated crash signal is old enough for recovery');
  assert(internalActionFromSignal(replaySignal) !== null, 'the persisted signal reconstructs into a validated internal action');
  const recovered = await runRouteJobRecovery(Date.now());
  assert(recovered.replayed >= 1, 'the recovery sweep replays a stranded typed completion');
  eq((await prisma.project.findFirst({ where: { workspaceId: wsId, id: project?.id ?? '' } }))?.baseImageRef, 'workspaces/recovered:test', 'the reconstructed job applies its authoritative completion');
  assert((await prisma.workspaceSignal.findUnique({ where: { id: replaySignal.id } }))?.processedAt instanceof Date, 'the recovered durable signal is marked processed');

  const supersededRequestId = `project-image-superseded-${String(stamp)}`;
  const supersededSignal = await prisma.workspaceSignal.create({
    data: {
      workspaceId: wsId,
      seq: 910_000 + (stamp % 10_000),
      kind: 'project-image-complete',
      payload: {
        op: 'project-image-complete', userId: owner.id, clientRequestId: supersededRequestId, version: 1,
        target: { projectId: project?.id ?? '' }, payload: { tag: 'workspaces/stale:test' },
      },
      createdAt: new Date(Date.now() - 60_000),
    },
  });
  await prisma.workspaceSignal.create({
    data: {
      workspaceId: wsId,
      seq: supersededSignal.seq + 1,
      kind: 'project-image-complete',
      payload: {
        op: 'project-image-complete', userId: owner.id, clientRequestId: `project-image-newer-${String(stamp)}`, version: 1,
        target: { projectId: project?.id ?? '' }, payload: { tag: 'workspaces/newer:test' },
      },
      processedAt: new Date(),
    },
  });
  await prisma.project.updateMany({ where: { workspaceId: wsId, id: project?.id ?? '' }, data: { baseImageRef: 'workspaces/newer:test' } });
  const supersededRecovery = await runRouteJobRecovery(Date.now());
  assert(supersededRecovery.superseded >= 1, 'recovery recognizes an older completion superseded by a later entity write');
  eq((await prisma.project.findFirst({ where: { workspaceId: wsId, id: project?.id ?? '' } }))?.baseImageRef, 'workspaces/newer:test', 'stale replay cannot overwrite newer authoritative state');
  assert((await prisma.workspaceSignal.findUnique({ where: { id: supersededSignal.id } }))?.processedAt instanceof Date, 'a superseded signal is terminally acknowledged');

  const runtimeTicket = await prisma.ticket.create({
    data: { workspaceId: wsId, projectId: project?.id ?? '', key: `DEV-RUNTIME-${String(stamp)}`, number: 800_000 + (stamp % 100_000), title: 'Runtime recovery', stageId: 'unrefined', status: 'idle', labels: [], branch: `DEV-RUNTIME-${String(stamp)}` },
  });
  const runtimeRequestId = `runtime-recovery-${String(stamp)}`;
  const runtimeIntentId = runtimeLaunchIntentId(wsId, runtimeRequestId);
  const runtimeAction: RuntimeLaunchPrepareInternalAction = {
    workspaceId: wsId,
    op: 'runtime-launch-prepare',
    target: { intentId: runtimeIntentId, ticketKey: runtimeTicket.key, projectId: runtimeTicket.projectId },
    payload: { mode: 'preview-open', branch: runtimeTicket.branch ?? '' },
    userId: owner.id,
    clientRequestId: runtimeRequestId,
  };
  await enqueueInternalAction(runtimeAction);
  await prisma.workspaceSignal.update({ where: { id: runtimeIntentId }, data: { createdAt: new Date(Date.now() - 60_000) } });
  let runtimeExecutions = 0;
  const runtimeRecovered = await runRuntimeJobRecovery(Date.now(), {
    execute: async () => { runtimeExecutions += 1; return { ok: true, url: 'https://preview.example.test/' }; },
  });
  assert(runtimeRecovered.replayed >= 1, 'a prepared runtime intent is re-driven outside the writer lease after a crash');
  eq(runtimeExecutions, 1, 'the stranded runtime intent executes exactly once in this recovery pass');
  const runtimeCompletion = await prisma.workspaceSignal.findUnique({ where: { id: runtimeLaunchCompletionId(wsId, runtimeIntentId) } });
  assert(runtimeCompletion?.processedAt instanceof Date, 'runtime recovery closes the durable prepare/completion pair');

  const pendingCompletionRequestId = `runtime-pending-completion-${String(stamp)}`;
  const pendingCompletionIntentId = runtimeLaunchIntentId(wsId, pendingCompletionRequestId);
  const pendingCompletionAction: RuntimeLaunchPrepareInternalAction = {
    ...runtimeAction,
    target: { ...runtimeAction.target, intentId: pendingCompletionIntentId },
    clientRequestId: pendingCompletionRequestId,
  };
  await enqueueInternalAction(pendingCompletionAction);
  await prisma.workspaceSignal.update({ where: { id: pendingCompletionIntentId }, data: { createdAt: new Date(Date.now() - 60_000) } });
  const pendingCompletionId = runtimeLaunchCompletionId(wsId, pendingCompletionIntentId);
  await prisma.workspaceSignal.create({
    data: {
      id: pendingCompletionId,
      workspaceId: wsId,
      seq: 930_000 + (stamp % 10_000),
      kind: 'runtime-launch-complete',
      payload: {
        op: 'runtime-launch-complete', userId: owner.id, clientRequestId: `runtime-complete:${pendingCompletionIntentId}`, version: 1,
        target: pendingCompletionAction.target, payload: { mode: 'preview-open', ok: true },
      },
      createdAt: new Date(Date.now() - 60_000),
    },
  });
  let duplicateExecutions = 0;
  await runRuntimeJobRecovery(Date.now(), { execute: async () => { duplicateExecutions += 1; return { ok: true }; } });
  eq(duplicateExecutions, 0, 'an existing pending completion prevents duplicate external runtime execution');
  const recoveredCompletion = await runRouteJobRecovery(Date.now());
  assert(recoveredCompletion.replayed >= 1, 'route recovery finishes a completion that crashed after signal append');
  assert((await prisma.workspaceSignal.findUnique({ where: { id: pendingCompletionId } }))?.processedAt instanceof Date, 'the pending runtime completion becomes processed without re-running Docker');

  const claimedAction: RuntimeLaunchPrepareInternalAction = {
    ...runtimeAction,
    target: { ...runtimeAction.target, intentId: runtimeLaunchIntentId(wsId, `claim-${String(stamp)}`) },
    clientRequestId: `claim-${String(stamp)}`,
  };
  let releaseClaim: (() => void) | null = null;
  const claimGate = new Promise<void>((resolve) => { releaseClaim = resolve; });
  let claimedExecutions = 0;
  const firstClaim = runPreparedRuntimeLaunch(claimedAction, {
    execute: async () => { claimedExecutions += 1; await claimGate; return { ok: true }; },
    complete: async () => undefined,
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  const competing = await runPreparedRuntimeLaunch(claimedAction, {
    execute: async () => { claimedExecutions += 1; return { ok: true }; },
    complete: async () => undefined,
  });
  eq(competing.error, 'runtime.pending', 'a concurrent recovery cannot duplicate a claimed external runtime launch');
  eq(claimedExecutions, 1, 'only the runtime claim owner reaches the external executor');
  releaseClaim?.();
  await firstClaim;

  const [tenantScopeError] = tryCatchSync(() => currentWorkspaceId());
  assert(tenantScopeError !== null, 'tenant context does not leak after completion');
} catch (error) {
  assert(false, `unexpected error during route-writer boundary test: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/routeWriterBoundary.test.mts');
