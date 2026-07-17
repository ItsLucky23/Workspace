//? Host-wide €-ceiling (gap-scan blind spot: budgets were per-workspace only). Against the REAL Mongo:
//? with WS_HOST_SPEND_CAP_EUR set below the current total metered spend, the media pre-generation guard
//? blocks with media.hostCapExceeded and isSpendEnforcementActive flips true even for a workspace with
//? NO per-workspace budget; with the cap unset both are unrestricted again.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { checkMediaBudget } = await import('../../server/media/budget.ts');
const { isSpendEnforcementActive, resetHostSpendCache, hostSpendTotalCents } = await import('../../server/spend/record.ts');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace.ts');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `hostcap-${String(stamp)}@youcomm.nl`, name: 'HostCap' } });
let wsId = '';

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'HostCap WS');
  wsId = created.workspaceId;

  //? Ensure there IS metered spend on the host (≥ €0.50 from this row alone).
  await prisma.mediaSpend.create({ data: { workspaceId: wsId, feature: 'test', providerId: 'test', costCents: 50 } });
  resetHostSpendCache();
  const total = await hostSpendTotalCents(prisma);
  assert(total >= 50, 'the host total sees the metered spend');

  //? Cap BELOW the current total → everything metered pauses.
  process.env.WS_HOST_SPEND_CAP_EUR = String(Math.max(0.01, (total - 10) / 100));
  resetHostSpendCache();
  const blocked = await checkMediaBudget(prisma, wsId, 1);
  eq(blocked.ok, false, 'media guard blocks when the host cap is reached');
  eq(blocked.reason, 'media.hostCapExceeded', 'with the host-cap reason (not the per-workspace one)');
  assert(await isSpendEnforcementActive(prisma, wsId), 'enforcement is active host-wide (pauseNew) without any per-workspace budget');

  //? Cap far above the total → unrestricted again.
  process.env.WS_HOST_SPEND_CAP_EUR = String((total + 100_000) / 100);
  resetHostSpendCache();
  const open = await checkMediaBudget(prisma, wsId, 1);
  eq(open.ok, true, 'under the host cap the guard passes');
  assert(!(await isSpendEnforcementActive(prisma, wsId)), 'no per-workspace budget + under host cap → no enforcement');

  //? No cap at all → no host restriction.
  delete process.env.WS_HOST_SPEND_CAP_EUR;
  resetHostSpendCache();
  eq((await checkMediaBudget(prisma, wsId, 1)).ok, true, 'absent cap = unlimited host');
} finally {
  delete process.env.WS_HOST_SPEND_CAP_EUR;
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  report('tests/integration/hostSpendCap.test.mts');
}
