//? B0 writer integration: public and server-internal actions share the durable
//? single-writer machinery without sharing an idempotency namespace.

import { tryCatch } from '@luckystack/core';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { ControlActionEnqueueError, enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { enqueueInternalAction } = await import('../../server/orchestrator/internalOps');
const roles = await import('../../server/automation/agentRoles');
const { currentWriterScope } = await import('../../server/orchestrator/writerContext');
const { claimControlAction, completeControlAction } = await import('../../server/orchestrator/cluster');

function documentAsset(assets: unknown, url: string): { extractStatus: unknown; extractedText: unknown } | null {
  if (!Array.isArray(assets)) return null;
  for (const entry of assets) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || !('url' in entry) || entry.url !== url) continue;
    return {
      extractStatus: 'extractStatus' in entry ? entry.extractStatus : undefined,
      extractedText: 'extractedText' in entry ? entry.extractedText : undefined,
    };
  }
  return null;
}

function signalRequestId(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || !('clientRequestId' in payload)) return null;
  return typeof payload.clientRequestId === 'string' ? payload.clientRequestId : null;
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `writer-foundation-${String(stamp)}@youcomm.nl`, name: 'Writer foundation' } });
let workspaceId = '';

const [runError] = await tryCatch(async () => {
  workspaceId = (await createBlankWorkspace(prisma, owner.id, 'Writer foundation WS')).workspaceId;
  const sourceUrl = `/media/writer-foundation-${String(stamp)}.txt`;
  const document = await prisma.document.create({
    data: {
      workspaceId,
      title: 'Internal completion target',
      content: '',
      assets: [{ kind: 'file', url: sourceUrl, label: 'Source', extractStatus: 'pending' }],
    },
  });
  const sharedRequestId = `writer-shared-${String(stamp)}`;

  eq(currentWriterScope(), null, 'writer context starts absent at the caller boundary');

  //? Rolling-deploy compatibility: public outcomes written before InternalOp namespacing must still replay.
  const legacyRequestId = `writer-legacy-${String(stamp)}`;
  const legacyClaim = await claimControlAction(`${workspaceId}:${legacyRequestId}`);
  assert(legacyClaim.state === 'claimed', 'the legacy public key can be prepared');
  if (legacyClaim.state === 'claimed') {
    await completeControlAction(`${workspaceId}:${legacyRequestId}`, legacyClaim.token, { state: 'success', signalSeq: 4242 });
  }
  const legacyReplay = await enqueueControlAction({
    workspaceId, op: 'rename-workspace', target: {}, payload: { name: 'Must not execute' },
    userId: owner.id, clientRequestId: legacyRequestId,
  });
  eq(legacyReplay.signalSeq, 4242, 'a pre-upgrade public terminal outcome replays from the established key');
  eq((await prisma.workspace.findUnique({ where: { id: workspaceId } }))?.name, 'Writer foundation WS', 'legacy replay does not execute the write again');

  const [publicResult, internalResult] = await Promise.all([
    enqueueControlAction({
      workspaceId, op: 'rename-workspace', target: {}, payload: { name: 'Public action completed' },
      userId: owner.id, clientRequestId: sharedRequestId,
    }),
    enqueueInternalAction({
      workspaceId, op: 'document-set-asset-text', target: { documentId: document.id },
      payload: { url: sourceUrl, text: 'Internal extracted source text.', status: 'ok' },
      userId: owner.id, clientRequestId: sharedRequestId,
    }),
  ]);

  assert(publicResult.signalSeq > 0 && internalResult.signalSeq > 0, 'public and internal actions each receive a durable signal seq');
  assert(publicResult.signalSeq !== internalResult.signalSeq, 'same request id still produces two independently ordered writer signals');
  eq((await prisma.workspace.findUnique({ where: { id: workspaceId } }))?.name, 'Public action completed', 'the public action executes');

  const completed = await prisma.document.findUnique({ where: { id: document.id } });
  const completedAsset = documentAsset(completed?.assets, sourceUrl);
  eq(completedAsset?.extractStatus, 'ok', 'the internal document completion updates extractStatus');
  eq(completedAsset?.extractedText, 'Internal extracted source text.', 'the internal document completion persists extracted text');

  const signals = await prisma.workspaceSignal.findMany({
    where: { workspaceId, kind: { in: ['rename-workspace', 'document-set-asset-text'] } },
    select: { kind: true, payload: true },
  });
  const sharedSignals = signals.filter(({ payload }) => signalRequestId(payload) === sharedRequestId);
  eq(sharedSignals.length, 2, 'public/internal dedup namespaces do not collide for the same request id');
  assert(sharedSignals.some(({ kind }) => kind === 'rename-workspace'), 'the public durable WorkspaceSignal exists');
  assert(sharedSignals.some(({ kind }) => kind === 'document-set-asset-text'), 'the internal durable WorkspaceSignal exists');

  const replayedInternal = await enqueueInternalAction({
    workspaceId, op: 'document-set-asset-text', target: { documentId: document.id },
    payload: { url: sourceUrl, text: 'A duplicate must not overwrite.', status: 'ok' },
    userId: owner.id, clientRequestId: sharedRequestId,
  });
  eq(replayedInternal.signalSeq, internalResult.signalSeq, 'an internal duplicate replays its terminal outcome');
  const afterReplay = documentAsset((await prisma.document.findUnique({ where: { id: document.id } }))?.assets, sourceUrl);
  eq(afterReplay?.extractedText, 'Internal extracted source text.', 'terminal internal dedup prevents duplicate execution');

  //? A grandchild that reuses the top action's internal dedup key sees it in writer ALS and receives
  //? control.pending immediately. The intermediate parent catches that expected refusal and completes.
  const ancestorRequestId = `writer-ancestor-${String(stamp)}`;
  const nestedRequestId = `writer-ancestor-nested-${String(stamp)}`;
  let ancestorChildCode: string | null = null;
  let ancestorChildElapsedMs = Number.POSITIVE_INFINITY;
  roles.registerAgentRole({
    key: 'writer-ancestor-leaf', label: 'Writer ancestor leaf', description: 'test', mutates: false,
    run: async (ctx) => {
      const startedAt = Date.now();
      const [nestedError] = await tryCatch(() => enqueueInternalAction({
        workspaceId: ctx.workspaceId, op: 'document-set-asset-text', target: { documentId: document.id },
        payload: { url: sourceUrl, text: 'Must never land.', status: 'ok' }, userId: owner.id, clientRequestId: ancestorRequestId,
      }));
      ancestorChildElapsedMs = Date.now() - startedAt;
      ancestorChildCode = nestedError instanceof ControlActionEnqueueError ? nestedError.code : nestedError?.message ?? null;
      return { kind: 'test', title: 'Expected ancestor refusal', body: ancestorChildCode ?? 'missing' };
    },
  });
  roles.registerAgentRole({
    key: 'writer-ancestor-parent', label: 'Writer ancestor parent', description: 'test', mutates: false,
    run: async (ctx) => {
      await enqueueInternalAction({
        workspaceId: ctx.workspaceId, op: 'automation-action-run', target: {}, userId: owner.id, clientRequestId: nestedRequestId,
        payload: { mode: 'execute', requiresApproval: false, action: { action: 'invoke-agent-role', params: { role: 'writer-ancestor-leaf' } } },
      });
      return null;
    },
  });
  const ancestorParent = await enqueueInternalAction({
    workspaceId, op: 'automation-action-run', target: {}, userId: owner.id, clientRequestId: ancestorRequestId,
    payload: { mode: 'execute', requiresApproval: false, action: { action: 'invoke-agent-role', params: { role: 'writer-ancestor-parent' } } },
  });
  eq(ancestorChildCode, 'control.pending', 'a grandchild reusing any active ancestor key fails as control.pending');
  assert(ancestorChildElapsedMs < 750, 'ancestor-key refusal is immediate and never incurs the 2s pending wait');
  const ancestorReplay = await enqueueInternalAction({
    workspaceId, op: 'automation-action-run', target: {}, userId: owner.id, clientRequestId: ancestorRequestId,
    payload: { mode: 'execute', requiresApproval: false, action: { action: 'invoke-agent-role', params: { role: 'writer-ancestor-parent' } } },
  });
  eq(ancestorReplay.signalSeq, ancestorParent.signalSeq, 'the parent that handled control.pending completes to a replayable terminal success');
  const blockedAncestorSignals = await prisma.workspaceSignal.findMany({ where: { workspaceId, kind: 'document-set-asset-text' }, select: { payload: true } });
  eq(blockedAncestorSignals.filter(({ payload }) => signalRequestId(payload) === ancestorRequestId).length, 0, 'the refused ancestor-key child appends no signal and performs no write');

  //? Internal/public namespaces remain distinct inside the same active writer tree even when the raw id matches.
  const crossNamespaceRequestId = `writer-cross-namespace-${String(stamp)}`;
  roles.registerAgentRole({
    key: 'writer-cross-namespace', label: 'Writer cross namespace', description: 'test', mutates: false,
    run: async (ctx) => {
      await enqueueControlAction({ workspaceId: ctx.workspaceId, op: 'rename-workspace', target: {}, payload: { name: 'Nested namespace allowed' }, userId: owner.id, clientRequestId: crossNamespaceRequestId });
      return null;
    },
  });
  await enqueueInternalAction({
    workspaceId, op: 'automation-action-run', target: {}, userId: owner.id, clientRequestId: crossNamespaceRequestId,
    payload: { mode: 'execute', requiresApproval: false, action: { action: 'invoke-agent-role', params: { role: 'writer-cross-namespace' } } },
  });
  eq((await prisma.workspace.findUnique({ where: { id: workspaceId } }))?.name, 'Nested namespace allowed', 'same raw id remains allowed across active internal/public namespaces');

  //? If a role does not handle the immediate child refusal, the parent deterministically fails and its
  //? terminal failure replays; the recovered workspace queue still accepts the next action.
  const failingRequestId = `writer-self-fail-${String(stamp)}`;
  let failingChildCode: string | null = null;
  let failingChildElapsedMs = Number.POSITIVE_INFINITY;
  roles.registerAgentRole({
    key: 'writer-self-fail', label: 'Writer self fail', description: 'test', mutates: false,
    run: async (ctx) => {
      const startedAt = Date.now();
      const [nestedError] = await tryCatch(() => enqueueInternalAction({
        workspaceId: ctx.workspaceId, op: 'document-set-asset-text', target: { documentId: document.id },
        payload: { url: sourceUrl, text: 'Must still never land.', status: 'ok' }, userId: owner.id, clientRequestId: failingRequestId,
      }));
      failingChildElapsedMs = Date.now() - startedAt;
      failingChildCode = nestedError instanceof ControlActionEnqueueError ? nestedError.code : nestedError?.message ?? null;
      if (nestedError) throw nestedError;
      return null;
    },
  });
  const enqueueFailingParent = (): Promise<unknown> => enqueueInternalAction({
    workspaceId, op: 'automation-action-run', target: {}, userId: owner.id, clientRequestId: failingRequestId,
    payload: { mode: 'execute', requiresApproval: false, action: { action: 'invoke-agent-role', params: { role: 'writer-self-fail' } } },
  });
  const [failingParentError] = await tryCatch(enqueueFailingParent);
  eq(failingChildCode, 'control.pending', 'a direct same-key child also receives control.pending');
  assert(failingChildElapsedMs < 750, 'direct same-key refusal is immediate and never self-waits');
  assert(failingParentError instanceof ControlActionEnqueueError && failingParentError.code === 'control.executionFailure', 'an unhandled child refusal makes the parent fail predictably');
  const replayStartedAt = Date.now();
  const [failingReplayError] = await tryCatch(enqueueFailingParent);
  assert(Date.now() - replayStartedAt < 750, 'the terminal parent failure replays without waiting');
  assert(failingReplayError instanceof ControlActionEnqueueError && failingReplayError.code === 'control.executionFailure', 'the failed parent replays its stable terminal failure');

  const recoveryRequestId = `writer-recovery-${String(stamp)}`;
  await enqueueInternalAction({
    workspaceId, op: 'document-set-asset-text', target: { documentId: document.id },
    payload: { url: sourceUrl, text: 'Queue recovered.', status: 'ok' }, userId: owner.id, clientRequestId: recoveryRequestId,
  });
  eq(documentAsset((await prisma.document.findUnique({ where: { id: document.id } }))?.assets, sourceUrl)?.extractedText, 'Queue recovered.', 'the writer queue remains usable after the predictable parent failure');
  eq(currentWriterScope(), null, 'writer context is absent after all executeAction calls settle');
});

roles.resetAgentRoles();
if (runError) assert(false, `unexpected writer foundation error: ${runError.message}`);
if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
else await prisma.user.deleteMany({ where: { id: owner.id } });

report('tests/integration/writerFoundation.test.mts');
