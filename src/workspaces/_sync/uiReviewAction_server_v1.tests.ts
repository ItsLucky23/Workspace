import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/uiReviewAction/v1` — U2 gap-fix acting on an open
//? "unfuck the UI" review request. `op` selects `ui-review-to-ticket` (turn it into a
//? redesign ticket) or `ui-review-dismiss`; both dispatch through `dispatchControlSync` →
//? the Conductor.
//?  [1] happy path — 'ui-review-to-ticket' on an open UiReviewRequest creates a redesign
//?      Ticket and flips the review to 'ticketed'; asserted via the REAL Prisma
//?      post-condition, not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` is rejected
//?      with `auth.forbidden`, and the review is left untouched (still 'open').

type UiReviewActionInput =
  | { op: 'ui-review-to-ticket'; reviewId: string; projectId: string; clientRequestId: string }
  | { op: 'ui-review-dismiss'; reviewId: string; clientRequestId: string };
interface UiReviewActionOk { status: 'success' }
interface UiReviewActionErr { status: 'error'; errorCode: string }
type UiReviewActionResponse = UiReviewActionOk | UiReviewActionErr;

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
    name: 'happy path: ui-review-to-ticket creates a redesign ticket + tickets the review (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'uireviewaction_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const page = `/settings-${String(Date.now())}`;
        const review = await ctx.prisma.uiReviewRequest.create({
          data: { workspaceId, projectId: project.id, page, screenshots: [], problems: ['contrast'], notes: 'too dark', status: 'open', createdById: userId },
        });

        const res = await ctx.callSync<UiReviewActionInput, UiReviewActionResponse>(
          { op: 'ui-review-to-ticket', reviewId: review.id, projectId: project.id, clientRequestId: `ura-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'ui-review-to-ticket returns status "success"');

        const updated = await poll(() => ctx.prisma.uiReviewRequest.findFirst({ where: { workspaceId, id: review.id, status: 'ticketed' } }));
        ctx.expect.ok(updated !== null, 'the Conductor flipped the review to ticketed (post-condition, not just the ack)');

        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId, title: `Redesign: ${page}` } });
        ctx.expect.ok(ticket !== null, 'the Conductor persisted the redesign ticket');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'uireviewaction_c2');
      const outsider = await createRealUser(ctx.prisma, 'uireviewaction_c2_outsider');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const review = await ctx.prisma.uiReviewRequest.create({
          data: { workspaceId, projectId: project.id, screenshots: [], problems: ['contrast'], status: 'open', createdById: userId },
        });

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<UiReviewActionInput, UiReviewActionResponse>(
          { op: 'ui-review-dismiss', reviewId: review.id, clientRequestId: `ura-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const unchanged = await ctx.prisma.uiReviewRequest.findFirst({ where: { workspaceId, id: review.id } });
        ctx.expect.eq(unchanged?.status, 'open', 'the review was left untouched by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
