import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/markRead/v1` — the login-only own-resource route
//? that enqueues `mark-read` (a single notification, or ALL of the caller's). The
//? auto-sweep already covers contract/auth/rate-limit/fuzz; these cases assert the
//? business-logic the sweep can't reach:
//?  [1] marking a single notification by id flips only THAT row — a sibling
//?      notification of the caller's stays unread, and (SEC5) another member's
//?      notification with the SAME id-shape is never touched — the update is
//?      userId-scoped, not just workspace-scoped.
//?  [2] `all: true` flips every one of the caller's notifications read, while
//?      another member's notification in the same workspace stays untouched.
//?
//? Integration test: `loginSeededUser` seeds a real workspace + owner membership;
//? Notification rows are pre-seeded directly via `ctx.prisma.notification` for
//? determinism (rather than relying on the demo seed's fixed content). Teardown via
//? `cleanupWorkspace` (covers `Notification` rows).

interface MarkReadOk {
  status: 'success';
  result: { accepted: true; signalSeq: number };
}
interface MarkReadErr {
  status: 'error';
  errorCode: string;
}
type MarkReadResponse = MarkReadOk | MarkReadErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'marking a single notification flips only that row, not a sibling or another member\'s',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'markRead_c1');
      const otherMember = await createRealUser(ctx.prisma, 'markRead_c1_other');
      try {
        await ctx.prisma.workspaceMember.create({ data: { workspaceId, userId: otherMember.id, roleKey: 'member' } });
        const target = await ctx.prisma.notification.create({ data: { workspaceId, userId, type: 'ai-suggestion', title: 'Target', body: 'body', read: false } });
        const sibling = await ctx.prisma.notification.create({ data: { workspaceId, userId, type: 'ai-suggestion', title: 'Sibling', body: 'body', read: false } });
        const othersNotification = await ctx.prisma.notification.create({ data: { workspaceId, userId: otherMember.id, type: 'ai-suggestion', title: 'Other member', body: 'body', read: false } });

        const res = await ctx.callApi<{ workspaceId: string; notificationId?: string; clientRequestId: string }, MarkReadResponse>({
          workspaceId,
          notificationId: target.id,
          clientRequestId: `markread-${String(Date.now())}`,
        });
        ctx.expect.eq(res.status, 'success', 'markRead returns status "success"');

        const targetRow = await ctx.prisma.notification.findUnique({ where: { id: target.id }, select: { read: true } });
        ctx.expect.eq(targetRow?.read, true, 'the targeted notification is flipped read');
        const siblingRow = await ctx.prisma.notification.findUnique({ where: { id: sibling.id }, select: { read: true } });
        ctx.expect.eq(siblingRow?.read, false, 'a sibling notification of the caller\'s stays unread');
        const otherRow = await ctx.prisma.notification.findUnique({ where: { id: othersNotification.id }, select: { read: true } });
        ctx.expect.eq(otherRow?.read, false, 'another member\'s notification is untouched (userId-scoped)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, otherMember.id]);
      }
    },
  },
  {
    name: 'all: true flips every one of the caller\'s notifications, not another member\'s',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'markRead_c2');
      const otherMember = await createRealUser(ctx.prisma, 'markRead_c2_other');
      try {
        await ctx.prisma.workspaceMember.create({ data: { workspaceId, userId: otherMember.id, roleKey: 'member' } });
        const own1 = await ctx.prisma.notification.create({ data: { workspaceId, userId, type: 'ai-suggestion', title: 'Own 1', body: 'body', read: false } });
        const own2 = await ctx.prisma.notification.create({ data: { workspaceId, userId, type: 'ai-suggestion', title: 'Own 2', body: 'body', read: false } });
        const othersNotification = await ctx.prisma.notification.create({ data: { workspaceId, userId: otherMember.id, type: 'ai-suggestion', title: 'Other member', body: 'body', read: false } });

        const res = await ctx.callApi<{ workspaceId: string; all?: boolean; clientRequestId: string }, MarkReadResponse>({
          workspaceId,
          all: true,
          clientRequestId: `markread-all-${String(Date.now())}`,
        });
        ctx.expect.eq(res.status, 'success', 'markRead returns status "success"');

        const unreadCount = await ctx.prisma.notification.count({ where: { workspaceId, userId, read: false } });
        ctx.expect.eq(unreadCount, 0, 'no unread notifications remain for the caller');
        const own1Row = await ctx.prisma.notification.findUnique({ where: { id: own1.id }, select: { read: true } });
        const own2Row = await ctx.prisma.notification.findUnique({ where: { id: own2.id }, select: { read: true } });
        ctx.expect.eq(own1Row?.read, true, 'notification 1 is read');
        ctx.expect.eq(own2Row?.read, true, 'notification 2 is read');
        const otherRow = await ctx.prisma.notification.findUnique({ where: { id: othersNotification.id }, select: { read: true } });
        ctx.expect.eq(otherRow?.read, false, 'another member\'s notification stays untouched');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, otherMember.id]);
      }
    },
  },
];
