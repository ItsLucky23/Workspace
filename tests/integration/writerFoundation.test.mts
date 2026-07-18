//? B0 writer integration: public and server-internal actions share the durable
//? single-writer machinery without sharing an idempotency namespace.

import { tryCatch } from '@luckystack/core';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { enqueueInternalAction } = await import('../../server/orchestrator/internalOps');
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
  eq(currentWriterScope(), null, 'writer context is absent after both executeAction calls settle');
});

if (runError) assert(false, `unexpected writer foundation error: ${runError.message}`);
if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
else await prisma.user.deleteMany({ where: { id: owner.id } });

report('tests/integration/writerFoundation.test.mts');
