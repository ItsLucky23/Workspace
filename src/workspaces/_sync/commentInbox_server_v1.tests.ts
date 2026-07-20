import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/commentInbox/v1` — the read-only comment inbox
//? (CI, DOCUMENTS_AND_SKILLS). Two ops: comments-refresh (network-backed, fetcher
//? injected in prod code — no PublishJob rows in the seeded workspace means the
//? real route call here touches no network and just returns zero counts) and
//? comments-mark-read (pure DB write, tested for its real Prisma post-condition).
//?  [1] happy path (comments-mark-read) — a room member marks a seeded SocialComment
//?      read; asserted via the REAL Prisma post-condition (the Conductor's
//?      single-writer persistence), not just the ack.
//?  [2] tenant/RBAC boundary — a user who is a room member but NOT a `WorkspaceMember`
//?      of this workspace is rejected with `auth.forbidden`, and the comment stays unread.

interface CommentInboxInput {
  op: string;
  clientRequestId: string;
  commentId?: string;
}
interface CommentInboxOk {
  status: 'success';
}
interface CommentInboxErr {
  status: 'error';
  errorCode: string;
}
type CommentInboxResponse = CommentInboxOk | CommentInboxErr;

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
    name: 'happy path (comments-mark-read) flips a SocialComment read (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'commentinbox_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const seeded = await ctx.prisma.socialComment.create({
          data: {
            workspaceId, platform: 'youtube', externalVideoId: `vid-${String(Date.now())}`,
            externalId: `cmt-${String(Date.now())}`, author: 'tester', text: 'hello', read: false,
            publishedAt: new Date(),
          },
        });
        const res = await ctx.callSync<CommentInboxInput, CommentInboxResponse>(
          { op: 'comments-mark-read', clientRequestId: `ci-c1-${String(Date.now())}`, commentId: seeded.id },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'commentInbox returns status "success"');

        const updated = await poll(async () => {
          const row = await ctx.prisma.socialComment.findFirst({ where: { workspaceId, id: seeded.id } });
          return row?.read === true ? row : null;
        });
        ctx.expect.ok(updated !== null, 'the Conductor marked the comment read (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'commentinbox_c2');
      const outsider = await createRealUser(ctx.prisma, 'commentinbox_c2_outsider');
      try {
        const seeded = await ctx.prisma.socialComment.create({
          data: {
            workspaceId, platform: 'youtube', externalVideoId: `vid-${String(Date.now())}`,
            externalId: `cmt-boundary-${String(Date.now())}`, author: 'tester', text: 'hello', read: false,
            publishedAt: new Date(),
          },
        });
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<CommentInboxInput, CommentInboxResponse>(
          { op: 'comments-mark-read', clientRequestId: `ci-c2-${String(Date.now())}`, commentId: seeded.id },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const stillUnread = await ctx.prisma.socialComment.findFirst({ where: { workspaceId, id: seeded.id } });
        ctx.expect.eq(stillUnread?.read, false, 'no write happened for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
