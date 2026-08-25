//? Integration test for cost/usage tracking (#16). `recordTurnSpend` writes a real SpendRecord +
//? bumps the session's running token estimate (against Mongo); `aggregateUsage` is a pure function
//? that rolls rows into the per-ticket + 7-day-activity shape the Usage page renders. Visibility
//? only — no enforcement is asserted (there is none; #16 never hard-stops).

import { redis } from '@luckystack/core';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const spend = await import('../../server/spend/record');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { enqueueInternalAction } = await import('../../server/orchestrator/internalOps');
const capacity = await import('../../server/orchestrator/capacity');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `spend-${String(stamp)}@youcomm.nl`, name: 'Spend Owner' } });
let workspaceId: string | null = null;
let capacityMember = '';
let capacityIdentity = '';
let capacityHeartbeat = '';

try {
  // ---- estTokens (pure) ----
  eq(spend.estTokens(0), 0, 'zero chars → zero tokens');
  eq(spend.estTokens(4), 1, '4 chars ≈ 1 token');
  eq(spend.estTokens(10), 3, '10 chars → ceil(10/4)=3 tokens');

  // ---- aggregateUsage (pure) ----
  const now = Date.UTC(2026, 6, 3, 12, 0, 0); // fixed clock
  const day = 24 * 60 * 60 * 1000;
  const keyById = new Map([['tA', 'DEV-1'], ['tB', 'DEV-2']]);
  const rows = [
    { ticketId: 'tA', tokensIn: 100, tokensOut: 200, createdAt: new Date(now - 1 * day) },
    { ticketId: 'tA', tokensIn: 50, tokensOut: 50, createdAt: new Date(now - 2 * day) },
    { ticketId: 'tB', tokensIn: 10, tokensOut: 10, createdAt: new Date(now - 1 * day) },
    { ticketId: null, tokensIn: 5, tokensOut: 5, createdAt: new Date(now - 40 * day) }, // outside the 7d window
  ];
  const usage = spend.aggregateUsage(rows, keyById, now);
  eq(usage.totalTurns, 4, 'all rows counted in totalTurns');
  eq(usage.totalTokens, 100 + 200 + 50 + 50 + 10 + 10 + 5 + 5, 'totalTokens sums every row');
  eq(usage.byTicket.length, 2, 'two tickets have usage (the null-ticket row is not per-ticket)');
  eq(usage.byTicket[0]?.ticketKey ?? '', 'DEV-1', 'the busiest ticket sorts first + maps ObjectId→DEV-key');
  eq(usage.byTicket[0]?.tokensIn ?? 0, 150, 'DEV-1 tokensIn summed across its turns');
  eq(usage.byTicket[0]?.turns ?? 0, 2, 'DEV-1 turn count');
  eq(usage.activity.length, 7, 'a dense 7-day activity series');
  eq(usage.activity[6]?.tokens ?? -1, 0, 'today (no rows) is zero-filled');
  eq(usage.activity[5]?.tokens ?? -1, 100 + 200 + 10 + 10, 'yesterday sums that day across tickets');

  // ---- recordTurnSpend (writes to Mongo) ----
  const created = await createBlankWorkspace(prisma, owner.id, 'Spend WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const ticket = await prisma.ticket.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', key: 'DEV-5000', number: 5000, title: 'Spendy', stageId: 'unrefined', status: 'idle', labels: [], priority: 'normal' } });
  const sessionKey = `worker:${ticket.id}:unrefined`;
  const runFence = 1;
  const session = await prisma.agentSession.create({ data: { workspaceId: wsId, ticketId: ticket.id, stageId: 'unrefined', kind: 'worker', sessionKey, status: 'busy', tokenEstimate: 0, runToken: 'spend-run-token', runFence, containerId: 'spend-container' } });
  capacityIdentity = `${wsId}::${ticket.key}`;
  capacityMember = `${capacityIdentity}::${String(runFence)}::spend-run-token`;
  const [activeKey, ownerKey, , , , heartbeatKey] = capacity.capacityRedisKeys(wsId, ticket.key, 'spend-run-token');
  capacityHeartbeat = heartbeatKey ?? '';
  await redis.zadd(activeKey ?? '', Date.now(), capacityMember);
  await redis.hset(ownerKey ?? '', capacityIdentity, capacityMember);
  await redis.set(capacityHeartbeat, capacityMember, 'PX', 60_000);

  const res = await spend.recordTurnSpend(prisma, { workspaceId: wsId, ticketId: ticket.id, stageId: 'unrefined', sessionKey, model: 'sonnet', inputChars: 4000, outputChars: 800 });
  eq(res.tokensIn, 1000, 'input chars → tokensIn estimate');
  eq(res.tokensOut, 200, 'output chars → tokensOut estimate');
  eq(res.costEstimate, 0, 'cost is 0 on the subscription (no per-model price)');
  const rec = await prisma.spendRecord.findFirst({ where: { workspaceId: wsId, ticketId: ticket.id } });
  assert(rec !== null && rec.tokensIn === 1000 && rec.tokensOut === 200, 'a SpendRecord row is persisted with the estimates');
  const sess = await prisma.agentSession.findUnique({ where: { id: session.id } });
  eq(sess?.tokenEstimate ?? 0, 1200, "the session's running token estimate is incremented");

  //? The stage-run path never calls recordTurnSpend directly: completion carries bounded char counts
  //? through one InternalOp. Replaying its stable request id must not append a second SpendRecord.
  const stageSpendBefore = await prisma.spendRecord.count({ where: { workspaceId: wsId, ticketId: ticket.id } });
  const stageSpendAction = {
    workspaceId: wsId,
    op: 'stage-turn-complete' as const,
    target: { ticketId: ticket.id, ticketKey: ticket.key, projectId: ticket.projectId, stageId: 'unrefined', sessionId: session.id, runToken: 'spend-run-token', runFence },
    payload: {
      containerId: 'spend-container',
      claudeSessionId: 'spend-claude',
      turn: { kind: 'continue' as const },
      spend: { userId: owner.id, model: 'sonnet', inputChars: 40, outputChars: 20 },
    },
    userId: 'stage-runner-test',
    clientRequestId: `stage-spend-${String(stamp)}`,
  };
  await enqueueInternalAction(stageSpendAction);
  await enqueueInternalAction(stageSpendAction);
  eq(await prisma.spendRecord.count({ where: { workspaceId: wsId, ticketId: ticket.id } }), stageSpendBefore + 1, 'duplicate turn completion appends exactly one stage SpendRecord');
  eq((await prisma.agentSession.findUnique({ where: { id: session.id } }))?.tokenEstimate, 1215, 'stage spend increments the exact session behind its container CAS');

  //? #99 — metered-budget enforcement read: a workspace under an enforced cap is NOT enforced; at/over it IS.
  eq(await spend.isSpendEnforcementActive(prisma, wsId), false, 'no enforced cap → provisioning not blocked');
  const cap = await prisma.workspaceBudget.create({ data: { workspaceId: wsId, label: 'Metered', cap: 10, spent: 3, enabled: true } });
  eq(await spend.isSpendEnforcementActive(prisma, wsId), false, 'under the cap → still not enforced');
  await prisma.workspaceBudget.update({ where: { id: cap.id }, data: { spent: 12 } });
  eq(await spend.isSpendEnforcementActive(prisma, wsId), true, 'over the enforced cap → provisioning blocked');
  await prisma.workspaceBudget.update({ where: { id: cap.id }, data: { enabled: false } });
  eq(await spend.isSpendEnforcementActive(prisma, wsId), false, 'a disabled cap does not enforce even when over');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  const [activeKey, ownerKey] = capacity.capacityRedisKeys('spend-cleanup', 'cleanup', 'cleanup');
  if (capacityMember) await redis.zrem(activeKey ?? '', capacityMember).catch(() => undefined);
  if (capacityIdentity) await redis.hdel(ownerKey ?? '', capacityIdentity).catch(() => undefined);
  if (capacityHeartbeat) await redis.del(capacityHeartbeat).catch(() => undefined);
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/spend.test.mts');
