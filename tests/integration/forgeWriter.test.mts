//? B1/SW-01 forge writer acceptance: webhook/snapshot writes enter only through
//? InternalOp/Public ControlOp apply, with exact project scope and stable dedup.

import { redis, tryCatch } from '@luckystack/core';

import type { ForgeWebhookDependencies } from '../../server/git/webhookRoute';
import type { ForgeResyncDependencies } from '../../src/workspaces/_sync/projectAdmin_server_v1';
import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { encryptSecret } = await import('../../server/crypto/secretBox');
const { enqueueInternalAction } = await import('../../server/orchestrator/internalOps');
const { claimControlAction, controlActionOutcomeKey } = await import('../../server/orchestrator/cluster');
const { currentWriterScope } = await import('../../server/orchestrator/writerContext');
const {
  applyForgeSnapshot,
  buildForgeSnapshot,
  forgeSnapshotRequestId,
  forgeTouchedKeys,
  runGitlabSyncTick,
} = await import('../../server/git/gitlabSync');
const { forgeEventRequestId, processForgeWebhook } = await import('../../server/git/webhookRoute');
const { dispatchControlSync } = await import('../../server/control/dispatchSync');
const { dispatchForgeResync } = await import('../../src/workspaces/_sync/projectAdmin_server_v1');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `forge-writer-${String(stamp)}@youcomm.nl`, name: 'Forge writer' } });
let workspaceId = '';
let foreignWorkspaceId = '';

const [runError] = await tryCatch(async () => {
  const created = await createBlankWorkspace(prisma, owner.id, 'Forge writer WS');
  workspaceId = created.workspaceId;
  const projectA = await prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
  assert(projectA !== null, 'the workspace has project A');
  if (!projectA) return;
  await prisma.project.update({ where: { id: projectA.id }, data: { name: 'A', gitlabPath: 'acme/a' } });
  const projectB = await prisma.project.create({ data: { workspaceId, name: 'B', gitlabPath: 'acme/b' } });
  await prisma.forgeConnection.create({
    data: {
      workspaceId,
      projectId: projectB.id,
      mode: 'gitlab',
      baseUrl: 'https://gitlab.example',
      repoPath: 'acme/b',
      tokenEnc: encryptSecret('forge-credential-must-not-enter-signal'),
      webhookSecret: 'project-webhook-secret',
      status: 'connected',
    },
  });
  await prisma.workspace.update({ where: { id: workspaceId }, data: { webhookSecret: 'workspace-webhook-secret' } });

  const snapshot = buildForgeSnapshot(projectB.id, 'gitlab', 'acme/b', [{ iid: 88, title: 'Snapshot issue' }]);
  const [outsideWriterError] = await tryCatch(() => applyForgeSnapshot(prisma, workspaceId, projectB.id, snapshot));
  assert(outsideWriterError !== null && outsideWriterError.message.includes('no active Conductor writer context'), 'a forge mutation helper rejects calls outside writer context');

  //? Route-only proof: an authenticated accepted event with a fake enqueue performs no DB write.
  const fakeBody = JSON.stringify({
    object_kind: 'issue',
    project: { path_with_namespace: 'acme/b' },
    object_attributes: { iid: 66, action: 'open', title: 'Must only be queued', state: 'opened' },
  });
  const fakeHeaders = {
    'x-gitlab-token': 'workspace-webhook-secret',
    'x-gitlab-event-uuid': `fake-${String(stamp)}`,
  };
  let fakeEnqueues = 0;
  const fakeDependencies: ForgeWebhookDependencies = {
    prisma,
    enqueue: async () => {
      fakeEnqueues += 1;
      return { signalSeq: 1, result: { ok: true, synced: 0, keys: [], skipped: 0 } };
    },
    broadcast: async () => undefined,
    now: () => stamp,
  };
  const fakeOutcome = await processForgeWebhook({ workspaceId, headers: fakeHeaders, rawBody: fakeBody }, fakeDependencies);
  eq(fakeOutcome.code, 200, 'the accepted webhook reaches enqueue');
  eq(fakeEnqueues, 1, 'the route enqueues exactly one internal action');
  eq(await prisma.ticket.count({ where: { workspaceId, key: 'DEV-66' } }), 0, 'the HTTP route does not directly create a ticket');
  eq((await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { webhookLastEventAt: true } }))?.webhookLastEventAt ?? null, null, 'the HTTP route does not directly update last-event metadata');

  const firstBody = JSON.stringify({
    object_kind: 'issue',
    project: { path_with_namespace: 'acme/b' },
    object_attributes: { iid: 67, action: 'open', title: 'Original delivery', state: 'opened' },
  });
  const deliveryHeaders = {
    'x-gitlab-token': 'workspace-webhook-secret',
    'x-gitlab-event-uuid': `delivery-${String(stamp)}`,
  };
  const firstOutcome = await processForgeWebhook({ workspaceId, headers: deliveryHeaders, rawBody: firstBody });
  eq(firstOutcome.code, 200, 'a real accepted delivery is applied through InternalOp');
  eq((await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-67' } }))?.projectId, projectB.id, 'the webhook ticket belongs to the matched project');
  assert((await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { webhookLastEventAt: true } }))?.webhookLastEventAt !== null, 'the internal action updates last-event metadata');

  const duplicateBody = JSON.stringify({
    object_kind: 'issue',
    project: { path_with_namespace: 'acme/b' },
    object_attributes: { iid: 67, action: 'update', title: 'Duplicate must not execute', state: 'opened' },
  });
  await processForgeWebhook({ workspaceId, headers: deliveryHeaders, rawBody: duplicateBody });
  eq((await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-67' } }))?.title, 'Original delivery', 'duplicate delivery UUID executes only once');
  const deliveryRequestId = forgeEventRequestId(workspaceId, firstBody, deliveryHeaders);
  eq(deliveryRequestId, forgeEventRequestId(workspaceId, duplicateBody, deliveryHeaders), 'GitLab event UUID, not mutable body, drives webhook idempotency');
  const githubDeliveryHeaders = { 'x-github-delivery': `github-${String(stamp)}` };
  eq(
    forgeEventRequestId(workspaceId, firstBody, githubDeliveryHeaders),
    forgeEventRequestId(workspaceId, duplicateBody, githubDeliveryHeaders),
    'GitHub delivery id drives webhook idempotency',
  );
  assert(
    forgeEventRequestId(workspaceId, firstBody, {}) !== forgeEventRequestId(workspaceId, duplicateBody, {}),
    'headerless webhook idempotency falls back to the workspace+raw-body digest',
  );
  assert(
    forgeEventRequestId(workspaceId, firstBody, { 'x-github-event': 'issues' })
      !== forgeEventRequestId(workspaceId, firstBody, { 'x-github-event': 'push' }),
    'fallback idempotency includes the GitHub event header when the body is identical',
  );
  assert(
    forgeEventRequestId(workspaceId, firstBody, { 'x-gitlab-event': 'Issue Hook' })
      !== forgeEventRequestId(workspaceId, firstBody, { 'x-gitlab-event': 'Push Hook' }),
    'fallback idempotency includes the GitLab event type when the body is identical',
  );

  //? Crash/retry replay: the authoritative write succeeds, but the first broadcast fails.
  //? Retrying the same delivery must recover the original touched keys from Redis.
  const replayBody = JSON.stringify({
    object_kind: 'issue',
    project: { path_with_namespace: 'acme/b' },
    object_attributes: { iid: 68, action: 'open', title: 'Replay broadcast', state: 'opened', url: 'https://gitlab.example/acme/b/-/issues/68' },
  });
  const replayHeaders = {
    'x-gitlab-token': 'workspace-webhook-secret',
    'x-gitlab-event-uuid': `replay-${String(stamp)}`,
  };
  let replayBroadcastAttempts = 0;
  const replayedBroadcasts: string[][] = [];
  const replayDependencies: ForgeWebhookDependencies = {
    prisma,
    enqueue: enqueueInternalAction,
    broadcast: async (_workspaceId, keys) => {
      replayBroadcastAttempts += 1;
      if (replayBroadcastAttempts === 1) throw new Error('injected crash before broadcast');
      replayedBroadcasts.push(keys);
    },
    now: () => stamp + 1000,
  };
  await processForgeWebhook({ workspaceId, headers: replayHeaders, rawBody: replayBody }, replayDependencies);
  await processForgeWebhook({ workspaceId, headers: replayHeaders, rawBody: replayBody }, replayDependencies);
  eq(replayBroadcastAttempts, 2, 'retry attempts the broadcaster again after the first post-write failure');
  eq(replayedBroadcasts, [['DEV-68']], 'retry broadcaster receives the same touched keys from the terminal replay');

  const deliverySignals = await prisma.workspaceSignal.findMany({ where: { workspaceId, kind: 'forge-event-apply' }, select: { payload: true } });
  eq(deliverySignals.filter(({ payload }) => JSON.stringify(payload).includes(deliveryRequestId)).length, 1, 'duplicate delivery appends one durable writer signal');

  const closeAt = stamp + 5000;
  const lifecycleDependencies: ForgeWebhookDependencies = {
    prisma,
    enqueue: enqueueInternalAction,
    broadcast: async () => undefined,
    now: () => closeAt,
  };
  const closed = await processForgeWebhook({
    workspaceId,
    headers: {
      'x-gitlab-token': 'workspace-webhook-secret',
      'x-gitlab-event-uuid': `close-${String(stamp)}`,
    },
    rawBody: JSON.stringify({
      object_kind: 'issue',
      project: { path_with_namespace: 'acme/b' },
      object_attributes: { iid: 67, action: 'close', title: 'Closed metadata', description: 'close update', state: 'closed', url: 'https://gitlab.example/acme/b/-/issues/67' },
      labels: [{ title: 'closed-label' }],
    }),
  }, lifecycleDependencies);
  eq(closed.message, 'ingested DEV-67', 'close returns the affected ticket key');
  const closedTicket = await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-67' }, select: { archived: true, title: true, description: true, labels: true } });
  eq(closedTicket, { archived: true, title: 'Closed metadata', description: 'close update', labels: ['closed-label'] }, 'close archives the existing ticket and applies its metadata update');
  eq((await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { webhookLastEventAt: true } }))?.webhookLastEventAt?.getTime(), closeAt, 'close still updates accepted-event metadata');

  const reopened = await processForgeWebhook({
    workspaceId,
    headers: {
      'x-gitlab-token': 'workspace-webhook-secret',
      'x-gitlab-event-uuid': `reopen-${String(stamp)}`,
    },
    rawBody: JSON.stringify({
      object_kind: 'issue',
      project: { path_with_namespace: 'acme/b' },
      object_attributes: { iid: 67, action: 'reopen', title: 'Reopened metadata', description: 'open again', state: 'opened', url: 'https://gitlab.example/acme/b/-/issues/67' },
    }),
  }, lifecycleDependencies);
  eq(reopened.message, 'ingested DEV-67', 'reopen returns the affected ticket key');
  eq((await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-67' }, select: { archived: true, title: true } })), { archived: false, title: 'Reopened metadata' }, 'reopen unarchives the existing ticket');

  const unknownClosed = await processForgeWebhook({
    workspaceId,
    headers: {
      'x-gitlab-token': 'workspace-webhook-secret',
      'x-gitlab-event-uuid': `close-unknown-${String(stamp)}`,
    },
    rawBody: JSON.stringify({
      object_kind: 'issue',
      project: { path_with_namespace: 'acme/b' },
      object_attributes: { iid: 69, action: 'close', title: 'Unknown closed', state: 'closed', url: 'https://gitlab.example/acme/b/-/issues/69' },
    }),
  }, lifecycleDependencies);
  eq(unknownClosed.message, 'no-op', 'an unknown closed issue is acknowledged without an affected key');
  eq(await prisma.ticket.count({ where: { workspaceId, key: 'DEV-69' } }), 0, 'an unknown close never creates a ticket');

  const ignoredAt = stamp + 10_000;
  const ignoredDependencies: ForgeWebhookDependencies = {
    prisma,
    enqueue: enqueueInternalAction,
    broadcast: async () => undefined,
    now: () => ignoredAt,
  };
  const ignored = await processForgeWebhook({
    workspaceId,
    headers: {
      'x-gitlab-token': 'workspace-webhook-secret',
      'x-gitlab-event-uuid': `ignored-${String(stamp)}`,
    },
    rawBody: JSON.stringify({ object_kind: 'push' }),
  }, ignoredDependencies);
  eq(ignored.message, 'ignored', 'a supported authenticated non-issue event is accepted as ignored');
  eq((await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { webhookLastEventAt: true } }))?.webhookLastEventAt?.getTime(), ignoredAt, 'accepted ignored events update metadata through InternalOp');

  await prisma.ticket.create({
    data: {
      workspaceId,
      projectId: projectA.id,
      key: 'DEV-77',
      number: 77,
      title: 'Sibling project truth',
      stageId: 'unrefined',
      status: 'idle',
    },
  });
  await processForgeWebhook({
    workspaceId,
    headers: {
      'x-gitlab-token': 'workspace-webhook-secret',
      'x-gitlab-event-uuid': `collision-${String(stamp)}`,
    },
    rawBody: JSON.stringify({
      object_kind: 'issue',
      project: { path_with_namespace: 'acme/b' },
      object_attributes: { iid: 77, action: 'update', title: 'Must not overwrite A', state: 'opened' },
    }),
  });
  const collision = await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-77' }, select: { projectId: true, title: true } });
  eq(collision?.projectId, projectA.id, 'DEV-iid collision remains on its original project');
  eq(collision?.title, 'Sibling project truth', 'DEV-iid collision never updates the sibling ticket');

  const snapshotRequestId = forgeSnapshotRequestId(snapshot);
  const firstSnapshot = await enqueueInternalAction({
    workspaceId,
    op: 'forge-snapshot-apply',
    target: { projectId: projectB.id },
    payload: { snapshot },
    userId: 'forge-writer-test',
    clientRequestId: snapshotRequestId,
  });
  eq(forgeTouchedKeys(firstSnapshot.result), ['DEV-88'], 'snapshot InternalOp returns safe touched keys');
  const duplicateSnapshot = await enqueueInternalAction({
    workspaceId,
    op: 'forge-snapshot-apply',
    target: { projectId: projectB.id },
    payload: { snapshot },
    userId: 'forge-writer-test',
    clientRequestId: snapshotRequestId,
  });
  eq(duplicateSnapshot.signalSeq, firstSnapshot.signalSeq, 'duplicate project+dataset digest replays one execution');
  eq(forgeTouchedKeys(duplicateSnapshot.result), ['DEV-88'], 'terminal replay preserves only the touched-key result needed by broadcasters');
  const storedSnapshotOutcome = await redis.get(controlActionOutcomeKey(`internal:${workspaceId}:${snapshotRequestId}`));
  assert(storedSnapshotOutcome !== null && !storedSnapshotOutcome.includes('Snapshot issue'), 'Redis terminal outcome never persists the arbitrary forge result');
  eq(
    await claimControlAction(`internal:${workspaceId}:${snapshotRequestId}`),
    { state: 'success', signalSeq: firstSnapshot.signalSeq, resultKeys: ['DEV-88'] },
    'Redis terminal outcome exposes only signalSeq plus bounded resultKeys',
  );
  eq(await prisma.workspaceSignal.count({ where: { workspaceId, kind: 'forge-snapshot-apply' } }), 1, 'duplicate dataset appends one durable signal');
  eq(await prisma.ticket.count({ where: { workspaceId, key: 'DEV-88' } }), 1, 'duplicate dataset creates one ticket');
  const firstUpdatedAt = (await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-88' }, select: { updatedAt: true } }))?.updatedAt.getTime();
  const afterOutcomeTtl = await enqueueInternalAction({
    workspaceId,
    op: 'forge-snapshot-apply',
    target: { projectId: projectB.id },
    payload: { snapshot },
    userId: 'forge-writer-test',
    //? Simulates the Redis terminal-outcome TTL having expired while the dataset stayed identical.
    clientRequestId: `${snapshotRequestId}:new-window`,
  });
  eq(forgeTouchedKeys(afterOutcomeTtl.result), [], 'same dataset in a later dedup window performs no ticket mutation');
  eq((await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-88' }, select: { updatedAt: true } }))?.updatedAt.getTime(), firstUpdatedAt, 'same dataset in a later dedup window leaves updatedAt unchanged');

  await prisma.ticket.create({
    data: {
      workspaceId,
      projectId: projectB.id,
      key: 'DEV-94',
      number: 94,
      title: 'Local-only ticket',
      stageId: 'unrefined',
      status: 'idle',
    },
  });
  const initialOpenSnapshot = buildForgeSnapshot(projectB.id, 'gitlab', 'acme/b', [
    { iid: 92, title: 'Still open', state: 'opened', web_url: 'https://gitlab.example/acme/b/-/issues/92' },
    { iid: 93, title: 'Will disappear', state: 'opened', web_url: 'https://gitlab.example/acme/b/-/issues/93' },
  ], false, true);
  await enqueueInternalAction({
    workspaceId,
    op: 'forge-snapshot-apply',
    target: { projectId: projectB.id },
    payload: { snapshot: initialOpenSnapshot },
    userId: 'forge-writer-test',
    clientRequestId: `full-initial-${String(stamp)}`,
  });
  const healedSnapshot = buildForgeSnapshot(projectB.id, 'gitlab', 'acme/b', [
    { iid: 92, title: 'Still open', state: 'opened', web_url: 'https://gitlab.example/acme/b/-/issues/92' },
  ], false, true);
  const healed = await enqueueInternalAction({
    workspaceId,
    op: 'forge-snapshot-apply',
    target: { projectId: projectB.id },
    payload: { snapshot: healedSnapshot },
    userId: 'forge-writer-test',
    clientRequestId: `full-heal-${String(stamp)}`,
  });
  eq(forgeTouchedKeys(healed.result), ['DEV-93'], 'an uncapped full open snapshot includes the absent ticket key');
  eq((await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-93' }, select: { archived: true } }))?.archived, true, 'a full open snapshot heals a missed close by archiving the absent forge ticket');

  const cappedSnapshot = buildForgeSnapshot(projectB.id, 'gitlab', 'acme/b', [], true, true);
  await enqueueInternalAction({
    workspaceId,
    op: 'forge-snapshot-apply',
    target: { projectId: projectB.id },
    payload: { snapshot: cappedSnapshot },
    userId: 'forge-writer-test',
    clientRequestId: `capped-no-absence-${String(stamp)}`,
  });
  eq((await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-92' }, select: { archived: true } }))?.archived, false, 'a capped snapshot never infers absence');

  const emptyFullSnapshot = buildForgeSnapshot(projectB.id, 'gitlab', 'acme/b', [], false, true);
  const emptyFull = await enqueueInternalAction({
    workspaceId,
    op: 'forge-snapshot-apply',
    target: { projectId: projectB.id },
    payload: { snapshot: emptyFullSnapshot },
    userId: 'forge-writer-test',
    clientRequestId: `full-empty-${String(stamp)}`,
  });
  eq(forgeTouchedKeys(emptyFull.result), ['DEV-92'], 'a later complete snapshot reports the final missed-close heal key');
  eq((await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-92' }, select: { archived: true } }))?.archived, true, 'an uncapped empty open snapshot archives the remaining forge-linked ticket');
  eq((await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-94' }, select: { archived: true } }))?.archived, false, 'full forge snapshots never archive an absent local-only ticket');

  const signalText = JSON.stringify(await prisma.workspaceSignal.findMany({
    where: { workspaceId, kind: { in: ['forge-event-apply', 'forge-snapshot-apply'] } },
    select: { payload: true },
  }));
  assert(!signalText.includes('forge-credential-must-not-enter-signal'), 'forge credential never enters WorkspaceSignal payload');
  assert(!signalText.includes('workspace-webhook-secret'), 'webhook credential never enters WorkspaceSignal payload');

  const mismatched = buildForgeSnapshot(projectA.id, 'gitlab', 'acme/a', [{ iid: 89, title: 'Wrong target' }]);
  const wrongTarget = await enqueueInternalAction({
    workspaceId,
    op: 'forge-snapshot-apply',
    target: { projectId: projectB.id },
    payload: { snapshot: mismatched },
    userId: 'forge-writer-test',
    clientRequestId: `wrong-target-${String(stamp)}`,
  });
  eq(forgeTouchedKeys(wrongTarget.result), [], 'snapshot project/target mismatch skips all writes');
  eq(await prisma.ticket.count({ where: { workspaceId, key: 'DEV-89' } }), 0, 'wrong-project snapshot creates no ticket');

  const foreign = await createBlankWorkspace(prisma, owner.id, 'Foreign forge WS');
  foreignWorkspaceId = foreign.workspaceId;
  const foreignProject = await prisma.project.findFirst({ where: { workspaceId: foreignWorkspaceId }, select: { id: true } });
  assert(foreignProject !== null, 'the foreign workspace has a project');
  if (foreignProject) {
    await prisma.project.update({ where: { id: foreignProject.id }, data: { gitlabPath: 'foreign/repo' } });
    const foreignSnapshot = buildForgeSnapshot(foreignProject.id, 'gitlab', 'foreign/repo', [{ iid: 90, title: 'Foreign' }]);
    const foreignResult = await enqueueInternalAction({
      workspaceId,
      op: 'forge-snapshot-apply',
      target: { projectId: foreignProject.id },
      payload: { snapshot: foreignSnapshot },
      userId: 'forge-writer-test',
      clientRequestId: `foreign-target-${String(stamp)}`,
    });
    eq(forgeTouchedKeys(foreignResult.result), [], 'a project from another workspace is skipped');
    eq(await prisma.ticket.count({ where: { workspaceId, key: 'DEV-90' } }), 0, 'foreign project cannot write into the active workspace');
  }

  //? Public resync: RBAC must run before fetch, and the fetched snapshot is dispatched
  //? while no writer context is held. The real dispatch re-checks RBAC before apply.
  const publicSnapshot = buildForgeSnapshot(projectB.id, 'gitlab', 'acme/b', [{ iid: 91, title: 'Public snapshot apply' }]);
  const publicResync = await dispatchForgeResync({
    prisma,
    workspaceId,
    userId: owner.id,
    projectId: projectB.id,
    clientRequestId: `real-public-resync-${String(stamp)}`,
  }, {
    authorize: async () => true,
    fetchSnapshot: async () => {
      eq(currentWriterScope(), null, 'real public resync fixture fetch is outside writer context');
      return { ok: true, snapshot: publicSnapshot };
    },
    dispatch: dispatchControlSync,
    broadcast: async () => undefined,
  });
  assert(publicResync.ok, 'public resync dispatch applies the pre-fetched snapshot through the Conductor');
  eq((await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-91' } }))?.projectId, projectB.id, 'public Conductor case applies to the exact target project');
  const publicSignal = await prisma.workspaceSignal.findFirst({
    where: { workspaceId, kind: 'gitlab-resync' },
    orderBy: { seq: 'desc' },
    select: { payload: true },
  });
  assert(!JSON.stringify(publicSignal?.payload).includes('Public snapshot apply'), 'public durable signal does not embed the issue dataset');

  let deniedFetches = 0;
  const deniedDependencies: ForgeResyncDependencies = {
    authorize: async () => false,
    fetchSnapshot: async () => { deniedFetches += 1; return { ok: true, snapshot }; },
    dispatch: async () => ({ ok: true, result: {} }),
    broadcast: async () => undefined,
  };
  const denied = await dispatchForgeResync({
    prisma,
    workspaceId,
    userId: owner.id,
    projectId: projectB.id,
    clientRequestId: `denied-resync-${String(stamp)}`,
  }, deniedDependencies);
  assert(!denied.ok && denied.errorCode === 'auth.forbidden', 'resync rejects failed RBAC');
  eq(deniedFetches, 0, 'failed RBAC prevents external fetch');

  const resyncOrder: string[] = [];
  const allowedDependencies: ForgeResyncDependencies = {
    authorize: async () => { resyncOrder.push('rbac'); return true; },
    fetchSnapshot: async () => {
      eq(currentWriterScope(), null, 'public resync external fetch runs outside writer context');
      resyncOrder.push('fetch');
      return { ok: true, snapshot };
    },
    dispatch: async (input) => {
      eq(currentWriterScope(), null, 'public dispatch begins after fetch with no inherited writer context');
      assert('snapshot' in (input.payload ?? {}), 'public dispatch carries the server-fetched snapshot');
      resyncOrder.push('dispatch');
      return { ok: true, result: { keys: ['DEV-88'] } };
    },
    broadcast: async () => { resyncOrder.push('broadcast'); },
  };
  const resynced = await dispatchForgeResync({
    prisma,
    workspaceId,
    userId: owner.id,
    projectId: projectB.id,
    clientRequestId: `allowed-resync-${String(stamp)}`,
  }, allowedDependencies);
  assert(resynced.ok, 'authorized public resync dispatches');
  eq(resyncOrder, ['rbac', 'fetch', 'dispatch', 'broadcast'], 'RBAC → fetch → apply dispatch → broadcast ordering is fixed');

  const pollOrder: string[] = [];
  await runGitlabSyncTick({
    listProjects: async () => [{ id: projectB.id, workspaceId }],
    fetchSnapshot: async () => {
      eq(currentWriterScope(), null, 'poller external fetch runs outside writer context');
      pollOrder.push('fetch');
      return { ok: true, snapshot };
    },
    enqueueSnapshot: async (action) => {
      eq(action.clientRequestId, forgeSnapshotRequestId(snapshot), 'poller uses stable project+dataset idempotency');
      pollOrder.push('enqueue');
      return { signalSeq: 5, result: { keys: ['DEV-88'] } };
    },
    broadcast: async () => { pollOrder.push('broadcast'); },
  });
  eq(pollOrder, ['fetch', 'enqueue', 'broadcast'], 'poller fetch completes before enqueue and broadcasts after result');
});

if (runError) assert(false, `unexpected forge-writer error: ${runError.message}`);
if (foreignWorkspaceId) await cleanupWorkspace(prisma, foreignWorkspaceId);
if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
else await prisma.user.deleteMany({ where: { id: owner.id } });

report('tests/integration/forgeWriter.test.mts');
