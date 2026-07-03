//? Integration test for the built-in MR-review backend (server/mr). Runs against real Mongo: proves
//? the unified-diff parser, and the review flow — a line comment creates a thread, an approval is not
//? stale at the current head but goes STALE when the head advances, and a thread resolves.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { parseUnifiedDiff } = await import('../../server/mr/diff');
const { addReviewComment, approveMr, resolveThread, mrForTicket } = await import('../../server/mr/service');
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `mr-${String(stamp)}@youcomm.nl`, name: 'MR Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'MR WS');
  const ws = created.workspaceId;
  workspaceId = ws;

  //? 1. diff parser
  const RAW = [
    'diff --git a/src/app.ts b/src/app.ts', 'index abc..def 100644', '--- a/src/app.ts', '+++ b/src/app.ts',
    '@@ -1,3 +1,4 @@', ' const x = 1;', '-const y = 2;', '+const y = 3;', '+const z = 4;', ' export { x };',
  ].join('\n');
  const d = parseUnifiedDiff(RAW);
  assert(d.files.length === 1 && d.additions === 2 && d.deletions === 1, 'parser: 1 file, +2/-1');
  eq(d.files[0]?.path, 'src/app.ts', 'parser: file path');

  //? 2. review flow over a real ticket
  await enqueueControlAction({ workspaceId: ws, op: 'quick-add', target: {}, payload: { title: 'MR ticket' }, userId: owner.id, clientRequestId: `mr-add-${String(stamp)}` });
  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: ws, title: 'MR ticket' } }));
  assert(ticket !== null, 'ticket created');
  const ticketKey = ticket?.key ?? '';
  const ticketId = ticket?.id ?? '';
  const projectId = ticket?.projectId ?? '';

  const mr = await prisma.mergeRequest.create({ data: { workspaceId: ws, projectId, ticketId, number: 1, title: 'MR ticket', sourceBranch: 'DEV-1', targetBranch: 'main', status: 'open', headSha: 'aaa111' } });

  await addReviewComment(prisma, ws, { mergeRequestId: mr.id, filePath: 'src/app.ts', line: 2, body: 'why not const?', authorId: owner.id });
  await approveMr(prisma, ws, mr.id, owner.id);

  let view = await mrForTicket(prisma, ws, ticketKey);
  assert(view?.threads.length === 1 && view.threads[0]?.comments.length === 1, 'comment created a line thread');
  eq(view?.threads[0]?.line, 2, 'thread anchored to line 2');
  eq(view?.approvals[0]?.stale, false, 'approval not stale at current head');

  await prisma.mergeRequest.update({ where: { id: mr.id }, data: { headSha: 'bbb222' } });
  view = await mrForTicket(prisma, ws, ticketKey);
  eq(view?.approvals[0]?.stale, true, 'approval goes stale after the head advances');

  await resolveThread(prisma, ws, view?.threads[0]?.id ?? '', true);
  view = await mrForTicket(prisma, ws, ticketKey);
  eq(view?.threads[0]?.resolved, true, 'thread resolves');

  await prisma.reviewComment.deleteMany({ where: { workspaceId: ws } });
  await prisma.reviewThread.deleteMany({ where: { workspaceId: ws } });
  await prisma.approval.deleteMany({ where: { workspaceId: ws } });
  await prisma.mergeRequest.deleteMany({ where: { workspaceId: ws } });
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/mr.test.mts');
