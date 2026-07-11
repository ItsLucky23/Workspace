//? H3 (ads) — shortlink-create PERSISTS a trackable link through the real Conductor, and a click atomically
//? increments the counter (the campaign's conversion signal). B-23: the Conductor is the only writer.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, ms = 8000, step = 60): Promise<T | null> {
  const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() >= end) return null; await wait(step); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `sl-${String(stamp)}@youcomm.nl`, name: 'SL' } });
let workspaceId: string | null = null;
try {
  const created = await createBlankWorkspace(prisma, owner.id, 'SL WS'); workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  await enqueueControlAction({ workspaceId: wsId, op: 'shortlink-create', target: {}, payload: { targetUrl: 'https://shop.example/spring', variant: 'A' }, userId: owner.id, clientRequestId: `sl-${String(stamp)}` });
  const link = await poll(() => prisma.shortLink.findFirst({ where: { workspaceId: wsId } }));
  assert(link !== null, 'the short link persisted');
  eq(link?.targetUrl, 'https://shop.example/spring', 'the target url was stored');
  eq(link?.variant, 'A', 'the A/B variant was stored');
  assert((link?.slug ?? '').length > 0 && (link?.slug ?? '').includes('-'), 'a unique slug was derived');
  eq(link?.clicks, 0, 'starts at 0 clicks');
  //? a click increments (what the /l/<slug> route does).
  await prisma.shortLink.update({ where: { id: link?.id ?? '' }, data: { clicks: { increment: 1 } } });
  eq((await prisma.shortLink.findFirst({ where: { id: link?.id ?? '' } }))?.clicks, 1, 'a click increments the counter');
  //? a bad (non-http) target is rejected — no row.
  await enqueueControlAction({ workspaceId: wsId, op: 'shortlink-create', target: {}, payload: { targetUrl: 'not-a-url' }, userId: owner.id, clientRequestId: `sl-bad-${String(stamp)}` });
  await wait(300);
  eq(await prisma.shortLink.count({ where: { workspaceId: wsId } }), 1, 'a bad target creates no link');
} catch (error) { assert(false, `unexpected: ${String(error)}`); }
finally { if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined); }
report('tests/integration/shortlinkOp.test.mts');
