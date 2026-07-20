import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/uiReviewCreate/v1` — U1: persist a "unfuck the UI"
//? review request (uploaded screenshots + ticked taxonomy problems + free-text). Dispatches
//? through `dispatchControlSync` → the Conductor, which sanitizes the screenshots/problems.
//?  [1] happy path — a room member creates a review request; asserted via the REAL Prisma
//?      post-condition (UiReviewRequest row), not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` is rejected
//?      with `auth.forbidden`, and no UiReviewRequest is created.

interface UiReviewCreateInput { projectId: string; screenshots: string[]; problems: string[]; page?: string; notes?: string; clientRequestId: string }
interface UiReviewCreateOk { status: 'success' }
interface UiReviewCreateErr { status: 'error'; errorCode: string }
type UiReviewCreateResponse = UiReviewCreateOk | UiReviewCreateErr;

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
    name: 'happy path creates an open UiReviewRequest (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'uireviewcreate_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const page = `/dashboard-${String(Date.now())}`;

        const res = await ctx.callSync<UiReviewCreateInput, UiReviewCreateResponse>(
          { projectId: project.id, screenshots: [], problems: ['color-contrast', 'spacing-alignment'], page, notes: 'looks cramped', clientRequestId: `urc-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'uiReviewCreate returns status "success"');

        const review = await poll(() => ctx.prisma.uiReviewRequest.findFirst({ where: { workspaceId, page } }));
        ctx.expect.ok(review !== null, 'the Conductor persisted the UiReviewRequest (post-condition, not just the ack)');
        ctx.expect.eq(review?.status, 'open', 'a freshly-created review request is open');
        ctx.expect.eq(review?.problems, ['color-contrast', 'spacing-alignment'], 'the ticked problems are persisted');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'uireviewcreate_c2');
      const outsider = await createRealUser(ctx.prisma, 'uireviewcreate_c2_outsider');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const page = `/should-not-be-created-${String(Date.now())}`;

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<UiReviewCreateInput, UiReviewCreateResponse>(
          { projectId: project.id, screenshots: [], problems: ['color-contrast'], page, clientRequestId: `urc-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const review = await ctx.prisma.uiReviewRequest.findFirst({ where: { workspaceId, page } });
        ctx.expect.ok(review === null, 'no UiReviewRequest was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
