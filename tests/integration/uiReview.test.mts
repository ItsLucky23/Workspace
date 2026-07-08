//? U1 — the ui-review-create control-op through the REAL Conductor + Mongo. Verifies: a request persists with
//? SANITIZED screenshots (only /media/) + problems (only taxonomy keys) + notes, tenant-scoped; and an empty
//? request (no screenshots, no problems) is rejected (no row).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ui-${String(stamp)}@youcomm.nl`, name: 'Ui' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Ui WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  await enqueueControlAction({
    workspaceId: wsId, op: 'ui-review-create', target: {},
    payload: { page: '/settings', screenshots: ['/media/shot1.png', 'https://evil/x.png', '/media/shot2.png'], problems: ['cluttered', 'made-up', 'not-responsive', 'cluttered'], notes: 'the buttons look off' },
    userId: owner.id, clientRequestId: `ui-${String(stamp)}`,
  });
  const req = await poll(() => prisma.uiReviewRequest.findFirst({ where: { workspaceId: wsId } }));
  assert(req !== null, 'the UI review request persisted');
  eq(req?.page, '/settings', 'the page label was stored');
  eq(req?.screenshots.length, 2, 'only the two /media/ screenshots were kept (external dropped)');
  assert((req?.screenshots ?? []).every((s) => s.startsWith('/media/')), 'no external screenshot url');
  eq(req?.problems.length, 2, 'only the valid, deduped taxonomy problems were kept');
  assert((req?.problems ?? []).includes('cluttered') && (req?.problems ?? []).includes('not-responsive') && !(req?.problems ?? []).includes('made-up'), 'off-taxonomy problem dropped');
  eq(req?.notes, 'the buttons look off', 'the free-text note was stored');
  eq(req?.status, 'open', 'a new request is open');
  eq(req?.createdById, owner.id, 'the creator is recorded');

  // an empty request is rejected (no second row)
  await enqueueControlAction({ workspaceId: wsId, op: 'ui-review-create', target: {}, payload: { screenshots: [], problems: [] }, userId: owner.id, clientRequestId: `ui-empty-${String(stamp)}` });
  await wait(300);
  eq(await prisma.uiReviewRequest.count({ where: { workspaceId: wsId } }), 1, 'an empty request is rejected (no row)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/uiReview.test.mts');
