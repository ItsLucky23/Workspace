import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/removeMember/v1` — deletes a `WorkspaceMember` row
//? via the Conductor (op `remove-member`, requires manageMembers).
//?  [1] happy path — owner removes a seeded demo member; asserted via the REAL Prisma
//?      post-condition (the `WorkspaceMember` row is gone), not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and the target row still exists.

interface RemoveMemberInput {
  memberId: string;
  clientRequestId: string;
}
interface RemoveMemberOk {
  status: 'success';
  removedMemberId: string;
}
interface RemoveMemberErr {
  status: 'error';
  errorCode: string;
}
type RemoveMemberResponse = RemoveMemberOk | RemoveMemberErr;

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
    name: 'happy path removes a seeded member (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'removemember_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const target = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, roleKey: 'member' } });
        ctx.expect.ok(target !== null, 'demo seed provides at least one non-owner "member" to remove');
        if (!target) return;

        const res = await ctx.callSync<RemoveMemberInput, RemoveMemberResponse>(
          { memberId: target.userId, clientRequestId: `rmmember-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'removeMember returns status "success"');

        const gone = await poll(async () => {
          const row = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: target.userId } });
          return row === null ? { deleted: true } : null;
        });
        ctx.expect.ok(gone !== null, 'the Conductor deleted the WorkspaceMember row (post-condition, not just the ack)');
      } finally {
        //? The removed demo user's own User row is still real — include it in cleanup.
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'removemember_c2');
      const outsider = await createRealUser(ctx.prisma, 'removemember_c2_outsider');
      try {
        const target = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, roleKey: 'member' } });
        ctx.expect.ok(target !== null, 'demo seed provides at least one non-owner "member" to target');
        if (!target) return;

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<RemoveMemberInput, RemoveMemberResponse>(
          { memberId: target.userId, clientRequestId: `rmmember-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const stillThere = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: target.userId } });
        ctx.expect.ok(stillThere !== null, 'the target was not removed by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
