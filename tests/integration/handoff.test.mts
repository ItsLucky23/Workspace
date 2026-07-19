//? Integration test for the token self-handoff (#4): the pure parse/budget/render helpers, and the
//? real record/reload cycle against Mongo — recordHandoff persists a Handoff + RESETS the session's
//? running token estimate (the reset frees context), and latestHandoff reads it back for the reload.

import { redis, tryCatch } from '@luckystack/core';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const ho = await import('../../server/orchestrator/handoff');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { enqueueInternalAction } = await import('../../server/orchestrator/internalOps');
const capacity = await import('../../server/orchestrator/capacity');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `handoff-${String(stamp)}@youcomm.nl`, name: 'Handoff Owner' } });
let workspaceId: string | null = null;
let capacityMember = '';
let capacityIdentity = '';
let capacityHeartbeat = '';

try {
  // ---- budget + shouldHandoff (pure) ----
  eq(ho.budgetForStage(null), ho.DEFAULT_WORKER_BUDGET, 'no per-stage budget → worker default');
  eq(ho.budgetForStage(50000), 50000, 'a positive per-stage budget wins');
  eq(ho.budgetForStage(0), ho.DEFAULT_WORKER_BUDGET, 'a zero budget falls back to the default');
  eq(ho.shouldHandoff(10, 100), false, 'under budget → no handoff');
  eq(ho.shouldHandoff(100, 100), true, 'at/over budget → handoff');

  // ---- parseHandoff (pure) ----
  const msg = 'Sure, here is my handoff.\n```ws-handoff\n{ "summary": "Building auth", "decisions": ["JWT over sessions"], "state": "login done", "next": ["add refresh"], "gotchas": ["cookie domain"], "carried": "DB schema notes" }\n```\ndone';
  const parsed = ho.parseHandoff(msg);
  assert(parsed !== null, 'a ws-handoff block is parsed');
  eq(parsed?.summary ?? '', 'Building auth', 'summary extracted');
  eq(parsed?.decisions.length ?? 0, 1, 'decisions extracted');
  eq(parsed?.carried ?? '', 'DB schema notes', 'carried extracted');
  eq(ho.parseHandoff('no block here'), null, 'no block → null');
  eq(ho.parseHandoff('```ws-handoff\n{ "summary": "" }\n```'), null, 'empty summary → null (nothing to carry)');
  eq(ho.parseHandoff('```ws-handoff\nnot json\n```'), null, 'malformed JSON → null');

  // ---- renderHandoffReload (pure) ----
  const reload = ho.renderHandoffReload({ summary: 'Building auth', decisions: ['JWT'], state: 'login done', next: ['refresh'], gotchas: ['cookies'], carried: 'schema' });
  assert(reload.includes('Building auth') && reload.includes('JWT') && reload.includes('refresh'), 'the reload text carries the key handoff parts');

  // ---- record + reset + reload (real Mongo) ----
  const created = await createBlankWorkspace(prisma, owner.id, 'Handoff WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const ticket = await prisma.ticket.create({ data: { workspaceId: wsId, projectId: (await prisma.project.findFirst({ where: { workspaceId: wsId } }))?.id ?? '', key: 'DEV-4444', number: 4444, title: 'Long turn', stageId: 'unrefined', status: 'busy', labels: [], priority: 'normal' } });
  const sessionKey = `worker:${ticket.id}:unrefined`;
  const runFence = 1;
  const session = await prisma.agentSession.create({ data: { workspaceId: wsId, ticketId: ticket.id, stageId: 'unrefined', kind: 'worker', sessionKey, status: 'busy', tokenEstimate: 130000, claudeSessionId: 'cs-old', runToken: 'handoff-run-token', runFence, containerId: 'handoff-container' } });
  capacityIdentity = `${wsId}::${ticket.key}`;
  capacityMember = `${capacityIdentity}::${String(runFence)}::handoff-run-token`;
  const [activeKey, ownerKey, , , , heartbeatKey] = capacity.capacityRedisKeys(wsId, ticket.key, 'handoff-run-token');
  capacityHeartbeat = heartbeatKey ?? '';
  await redis.zadd(activeKey ?? '', Date.now(), capacityMember);
  await redis.hset(ownerKey ?? '', capacityIdentity, capacityMember);
  await redis.set(capacityHeartbeat, capacityMember, 'PX', 60_000);

  const [outsideWriterError] = await tryCatch(() => ho.recordHandoff(prisma, { id: 'f'.repeat(24), workspaceId: wsId, sessionKey, ticketId: ticket.id, stageId: 'unrefined', body: parsed!, reason: 'budget' }));
  assert(outsideWriterError !== null && outsideWriterError.message.includes('no active Conductor writer context'), 'the Handoff mutation helper rejects calls outside the writer boundary');
  await enqueueInternalAction({
    workspaceId: wsId,
    op: 'stage-handoff-complete',
    target: { ticketId: ticket.id, ticketKey: ticket.key, projectId: ticket.projectId, stageId: 'unrefined', sessionId: session.id, runToken: 'handoff-run-token', runFence },
    payload: { containerId: 'handoff-container', expectedClaudeSessionId: 'cs-old', body: parsed!, reason: 'budget' },
    userId: 'stage-runner-test',
    clientRequestId: `handoff-complete-${String(stamp)}`,
  });
  const rec = await prisma.handoff.findFirst({ where: { workspaceId: wsId, sessionKey } });
  assert(rec !== null, 'the stage-handoff-complete InternalOp persisted a Handoff record');
  assert(rec !== null && rec.reason === 'budget', 'the Handoff row has the budget reason');
  const sess = await prisma.agentSession.findFirst({ where: { workspaceId: wsId, sessionKey } });
  eq(sess?.tokenEstimate ?? -1, 0, 'the session token estimate is RESET after the handoff (context freed)');
  eq(sess?.claudeSessionId ?? null, null, 'the same writer op clears claudeSessionId behind session+container CAS');

  const back = await ho.latestHandoff(prisma, wsId, sessionKey);
  eq(back?.summary ?? '', 'Building auth', 'latestHandoff reads the stored handoff back for the reload');
  eq(await ho.latestHandoff(prisma, wsId, 'worker:none:none'), null, 'no handoff → null');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  const [activeKey, ownerKey] = capacity.capacityRedisKeys('handoff-cleanup', 'cleanup', 'cleanup');
  if (capacityMember) await redis.zrem(activeKey ?? '', capacityMember).catch(() => undefined);
  if (capacityIdentity) await redis.hdel(ownerKey ?? '', capacityIdentity).catch(() => undefined);
  if (capacityHeartbeat) await redis.del(capacityHeartbeat).catch(() => undefined);
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/handoff.test.mts');
