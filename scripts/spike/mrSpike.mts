//? Spike — prove the built-in MR-review backend (BUILTIN_MR_REVIEW):
//?  1. parseUnifiedDiff structures a real git diff (files, +/- counts, line kinds).
//?  2. DB flow against real Mongo: comment → a thread+comment appears in the view; approve → an
//?     approval appears (not stale); advancing the MR head makes the approval STALE; resolve marks
//?     the thread resolved.
//? Run (needs the DB tunnel): npx tsx scripts/spike/mrSpike.mts

import { db } from '../../tests/_helpers.mts';

const prisma = await db();
const { parseUnifiedDiff } = await import('../../server/mr/diff');
const { addReviewComment, approveMr, resolveThread, mrForTicket } = await import('../../server/mr/service');

const ok = (label: string, cond: boolean): void => { console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`); };

//? 1. diff parser
const RAW = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index abc123..def456 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,4 @@',
  ' const x = 1;',
  '-const y = 2;',
  '+const y = 3;',
  '+const z = 4;',
  ' export { x };',
].join('\n');
const d = parseUnifiedDiff(RAW);
ok(`parser: 1 file, +2/-1 (got ${String(d.files.length)} files, +${String(d.additions)}/-${String(d.deletions)})`,
  d.files.length === 1 && d.additions === 2 && d.deletions === 1 && d.files[0]?.path === 'src/app.ts');

//? 2. DB flow — attach a synthetic MR to a real ticket, exercise comment/approve/staleness/resolve.
const WS = '6a46529cb23a6511a8afdb7a';
const ticket = await prisma.ticket.findFirst({ where: { workspaceId: WS }, select: { id: true, key: true, projectId: true } });
const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: WS }, select: { userId: true } });
if (!ticket || !member) { console.log('✗ FAIL  no ticket/member in workspace to test against'); process.exit(1); }

await prisma.mergeRequest.deleteMany({ where: { workspaceId: WS, number: 9999 } });
const mr = await prisma.mergeRequest.create({
  data: { workspaceId: WS, projectId: ticket.projectId, ticketId: ticket.id, number: 9999, title: 'spike MR', sourceBranch: 'DEV-spike', targetBranch: 'main', status: 'open', headSha: 'aaa111' },
});

await addReviewComment(prisma, WS, { mergeRequestId: mr.id, filePath: 'src/app.ts', line: 2, body: 'why not const?', authorId: member.userId, authorKind: 'user' });
await approveMr(prisma, WS, mr.id, member.userId);

let view = await mrForTicket(prisma, WS, ticket.key);
ok('view: 1 thread with 1 comment on src/app.ts:2', view?.threads.length === 1 && view.threads[0]?.comments.length === 1 && view.threads[0]?.line === 2);
ok('view: 1 approval, NOT stale (head matches)', view?.approvals.length === 1 && view.approvals[0]?.stale === false);

//? Advance the head → the approval must go stale.
await prisma.mergeRequest.update({ where: { id: mr.id }, data: { headSha: 'bbb222' } });
view = await mrForTicket(prisma, WS, ticket.key);
ok('view: approval STALE after head advanced', view?.approvals[0]?.stale === true);

//? Resolve the thread.
const threadId = view?.threads[0]?.id ?? '';
await resolveThread(prisma, WS, threadId, true);
view = await mrForTicket(prisma, WS, ticket.key);
ok('view: thread resolved', view?.threads[0]?.resolved === true);

//? cleanup
await prisma.reviewComment.deleteMany({ where: { workspaceId: WS, mergeRequestId: mr.id } });
await prisma.reviewThread.deleteMany({ where: { workspaceId: WS, mergeRequestId: mr.id } });
await prisma.approval.deleteMany({ where: { workspaceId: WS, mergeRequestId: mr.id } });
await prisma.mergeRequest.deleteMany({ where: { workspaceId: WS, id: mr.id } });

console.log('done');
process.exit(0);
