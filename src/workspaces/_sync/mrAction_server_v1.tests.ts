import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/mrAction/v1` — the built-in MR-review realtime action
//? route (BUILTIN_MR_REVIEW). `action` selects the control-op (create/comment/approve/
//? merge/rollback/resolve/review); this route only re-checks the ticketKey/action shape,
//? RBAC + the actual write all happen in `dispatchControlSync` → the Conductor.
//?  [1] happy path — 'create' opens an MR for a ticket with a `branch` (no bare git clone
//?      exists in this harness, so `createMr` gracefully persists `headSha: null` — proven
//?      by `server/git/repoStore.ts` `branchHead`'s `existsSync` guard; no Docker/PTY
//?      needed), then 'comment' adds a review thread+comment on it, then 'approve' and
//?      'resolve' (both pure DB writes, no Docker/git needed) — all asserted via the
//?      REAL Prisma post-condition (MergeRequest / ReviewComment / Approval / ReviewThread
//?      rows), not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` is rejected
//?      with `auth.forbidden`, and no MergeRequest is created.
//?
//? 'merge'/'rollback' need a real bare git clone (headSha) — deferred, see the report.

interface MrActionInput {
  clientRequestId: string; action: string; ticketKey: string;
  mrId?: string; body?: string; threadId?: string; filePath?: string; line?: number; side?: string; resolved?: boolean;
}
interface MrActionOk { status: 'success'; mr: { id: string } | null }
interface MrActionErr { status: 'error'; errorCode: string }
type MrActionResponse = MrActionOk | MrActionErr;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T | null>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path: create opens an MR, comment adds a review thread (Prisma post-conditions)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'mraction_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const key = `DEV-${String(Date.now() % 100000)}`;
        const ticket = await ctx.prisma.ticket.create({
          data: {
            workspaceId, projectId: project.id, key, number: Date.now() % 100000,
            title: 'MR action test ticket', stageId: 'unrefined', status: 'idle', labels: [], branch: 'feature/mr-action-test',
          },
        });

        const createRes = await ctx.callSync<MrActionInput, MrActionResponse>(
          { clientRequestId: `mr-c1-create-${String(Date.now())}`, action: 'create', ticketKey: key },
          { receiver: workspaceId },
        );
        ctx.expect.eq(createRes.status, 'success', 'mr-create returns status "success"');

        const mr = await poll(() => ctx.prisma.mergeRequest.findFirst({ where: { workspaceId, ticketId: ticket.id } }));
        ctx.expect.ok(mr !== null, 'the Conductor persisted the MergeRequest (post-condition, not just the ack)');
        ctx.expect.eq(mr?.status, 'open', 'a freshly-created MR is open');

        const body = `A review comment ${String(Date.now())}`;
        const commentRes = await ctx.callSync<MrActionInput, MrActionResponse>(
          { clientRequestId: `mr-c1-comment-${String(Date.now())}`, action: 'comment', ticketKey: key, mrId: mr?.id, body },
          { receiver: workspaceId },
        );
        ctx.expect.eq(commentRes.status, 'success', 'mr-comment returns status "success"');

        const comment = await poll(() => ctx.prisma.reviewComment.findFirst({ where: { workspaceId, mergeRequestId: mr?.id, body } }));
        ctx.expect.ok(comment !== null, 'the Conductor persisted the ReviewComment (post-condition, not just the ack)');

        const approveRes = await ctx.callSync<MrActionInput, MrActionResponse>(
          { clientRequestId: `mr-c1-approve-${String(Date.now())}`, action: 'approve', ticketKey: key, mrId: mr?.id },
          { receiver: workspaceId },
        );
        ctx.expect.eq(approveRes.status, 'success', 'mr-approve returns status "success"');

        const approval = await poll(() => ctx.prisma.approval.findFirst({ where: { workspaceId, mergeRequestId: mr?.id, userId } }));
        ctx.expect.ok(approval !== null, 'the Conductor persisted the Approval (post-condition, not just the ack)');

        const thread = await poll(() => ctx.prisma.reviewThread.findFirst({ where: { workspaceId, mergeRequestId: mr?.id, id: comment?.threadId } }));
        ctx.expect.ok(thread !== null, 'the review thread created alongside the comment exists');
        const resolveRes = await ctx.callSync<MrActionInput, MrActionResponse>(
          { clientRequestId: `mr-c1-resolve-${String(Date.now())}`, action: 'resolve', ticketKey: key, threadId: thread?.id, resolved: true },
          { receiver: workspaceId },
        );
        ctx.expect.eq(resolveRes.status, 'success', 'mr-resolve returns status "success"');

        const resolvedThread = await poll(async () => {
          const row = await ctx.prisma.reviewThread.findFirst({ where: { workspaceId, id: thread?.id } });
          return row?.resolved === true ? row : null;
        });
        ctx.expect.ok(resolvedThread !== null, 'the Conductor persisted the thread as resolved (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'mraction_c2');
      const outsider = await createRealUser(ctx.prisma, 'mraction_c2_outsider');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const key = `DEV-${String(Date.now() % 100000)}`;
        await ctx.prisma.ticket.create({
          data: {
            workspaceId, projectId: project.id, key, number: Date.now() % 100000,
            title: 'MR action outsider test ticket', stageId: 'unrefined', status: 'idle', labels: [], branch: 'feature/mr-action-outsider',
          },
        });

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<MrActionInput, MrActionResponse>(
          { clientRequestId: `mr-c2-${String(Date.now())}`, action: 'create', ticketKey: key },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const mr = await ctx.prisma.mergeRequest.findFirst({ where: { workspaceId, sourceBranch: 'feature/mr-action-outsider' } });
        ctx.expect.ok(mr === null, 'no MergeRequest was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
