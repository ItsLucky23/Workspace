//? H2 — spend is now ATTRIBUTED to a user through Mongo. Verifies recordTurnSpend stores the userId, and
//? aggregateByUser over the persisted rows reports each user's totals (the fairness / per-user-budget read).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { recordTurnSpend, aggregateByUser } = await import('../../server/spend/record');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `us-${String(stamp)}@youcomm.nl`, name: 'Us' } });
const other = await prisma.user.create({ data: { email: `us2-${String(stamp)}@youcomm.nl`, name: 'Us2' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Spend WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  await recordTurnSpend(prisma, { workspaceId: wsId, userId: owner.id, sessionKey: 's1', model: 'sonnet', inputChars: 4000, outputChars: 4000 });
  await recordTurnSpend(prisma, { workspaceId: wsId, userId: owner.id, sessionKey: 's1', model: 'sonnet', inputChars: 4000, outputChars: 0 });
  await recordTurnSpend(prisma, { workspaceId: wsId, userId: other.id, sessionKey: 's2', model: 'haiku', inputChars: 400, outputChars: 400 });

  const rows = await prisma.spendRecord.findMany({ where: { workspaceId: wsId }, select: { userId: true, tokensIn: true, tokensOut: true, costEstimate: true } });
  eq(rows.length, 3, 'three spend rows recorded');
  assert(rows.every((r) => r.userId !== null), 'every row is attributed to a user');

  const agg = aggregateByUser(rows);
  const ownerUsage = agg.find((u) => u.userId === owner.id);
  eq(ownerUsage?.turns, 2, 'the owner has two attributed turns');
  eq(ownerUsage?.tokensIn, 2000, 'the owner input tokens summed (2×1000)');
  eq(agg[0].userId, owner.id, 'the owner is the heaviest spender');
  assert(agg.some((u) => u.userId === other.id), 'the other user appears too');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id, other.id]).catch(() => undefined);
  else await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } }).catch(() => undefined);
}

report('tests/integration/userSpendAttribution.test.mts');
