//? Integration test for F0.2 (media €-budget + guard, ADR 0051). Real Conductor + Mongo. Sets a per-
//? workspace media cap via the `edit-media-budget` control-op (B-23), then asserts the pre-generation
//? guard (checkMediaBudget) blocks a gen that would exceed the cap and that recordMediaSpend debits the
//? running budget. Cost in CENTS (metered €). No cap / disabled = unlimited. Self-cleans.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { checkMediaBudget, recordMediaSpend } = await import('../../server/media/budget');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f02-${String(stamp)}@youcomm.nl`, name: 'CP F02' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F02 WS' }, userId: owner.id, clientRequestId: `f02-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? No budget yet → unlimited.
  const free = await checkMediaBudget(prisma, wsId, 99_999);
  assert(free.ok && free.unlimited, 'no media budget = unlimited (gen allowed)');

  //? Set a cap of €1.00 (100 cents), enabled, via the control-op (B-23 write path).
  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 100, alertPct: 80, enabled: true }, userId: owner.id, clientRequestId: `f02-eb-${String(stamp)}` });
  const budget = await poll(() => prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }));
  eq(budget?.capCents, 100, 'the control-op set the media cap (cents)');
  assert(budget?.enabled === true, 'the media budget is enabled');

  //? Under the cap → ok.
  const within = await checkMediaBudget(prisma, wsId, 50);
  assert(within.ok && !within.unlimited, 'a 50c gen is within the 100c cap');
  eq(within.remainingCents, 100, 'remaining = full cap before any spend');

  //? Record a 50c spend → running spend debits.
  await recordMediaSpend(prisma, wsId, { feature: 'image-gen', providerId: 'fal', costCents: 50 });
  const afterSpend = await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } });
  eq(afterSpend?.spentCents, 50, 'recordMediaSpend debited the running budget');
  eq(await prisma.mediaSpend.count({ where: { workspaceId: wsId } }), 1, 'a €-ledger row was written');

  //? A 60c gen would push 50+60=110 > 100 → blocked with the typed reason.
  const over = await checkMediaBudget(prisma, wsId, 60);
  assert(!over.ok, 'a gen that would exceed the cap is blocked');
  eq(over.reason, 'media.budgetExceeded', 'the block carries the typed reason');
  eq(over.remainingCents, 50, 'remaining reflects the prior spend (100-50)');

  //? Exactly filling the cap is allowed.
  const exact = await checkMediaBudget(prisma, wsId, 50);
  assert(exact.ok, 'a gen that exactly fills the remaining cap is allowed');

  //? Disabling the budget → unlimited again.
  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 100, enabled: false }, userId: owner.id, clientRequestId: `f02-eb2-${String(stamp)}` });
  await poll(async () => ((await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }))?.enabled === false ? true : null));
  const disabled = await checkMediaBudget(prisma, wsId, 99_999);
  assert(disabled.ok && disabled.unlimited, 'a disabled budget = unlimited again');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/mediaBudget.test.mts');
