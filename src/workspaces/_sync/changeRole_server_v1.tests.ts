import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/changeRole/v1` — changes a member's `roleKey` via
//? the Conductor (op `change-role`, requires manageMembers).
//?  [1] happy path — owner re-roles a seeded demo member to `admin`; asserted via the
//?      REAL Prisma post-condition (`WorkspaceMember.roleKey`), not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and the target's role is unchanged.

interface ChangeRoleInput {
  memberId: string;
  roleKey: string;
  clientRequestId: string;
}
interface ChangeRoleOk {
  status: 'success';
  memberId: string;
  roleKey: string;
}
interface ChangeRoleErr {
  status: 'error';
  errorCode: string;
}
type ChangeRoleResponse = ChangeRoleOk | ChangeRoleErr;

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
    name: 'happy path re-roles a seeded member (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'changerole_c1');
      try {
        await joinRoom(ctx, workspaceId);
        //? The demo seed (seedDemoWorkspace) creates several non-owner members with roleKey
        //? 'member' — pick one; never the owner (SEC1 protects the owner's own membership).
        const target = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, roleKey: 'member' } });
        ctx.expect.ok(target !== null, 'demo seed provides at least one non-owner "member" to re-role');
        if (!target) return;

        const res = await ctx.callSync<ChangeRoleInput, ChangeRoleResponse>(
          { memberId: target.userId, roleKey: 'admin', clientRequestId: `chrole-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'changeRole returns status "success"');
        //? F-024: the ack carries the RAW roleKey — the provider's member delta + the Members-tab
        //? dropdown key on it (custom roles would otherwise flatten to 'member' and never display).
        if (res.status === 'success') ctx.expect.eq(res.roleKey, 'admin', 'ack echoes the raw roleKey for the client-side member delta');

        const updated = await poll(async () => {
          const row = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: target.userId } });
          return row?.roleKey === 'admin' ? row : null;
        });
        ctx.expect.ok(updated !== null, 'the Conductor persisted the new roleKey (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'changerole_c2');
      const outsider = await createRealUser(ctx.prisma, 'changerole_c2_outsider');
      try {
        const target = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, roleKey: 'member' } });
        ctx.expect.ok(target !== null, 'demo seed provides at least one non-owner "member" to target');
        if (!target) return;

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ChangeRoleInput, ChangeRoleResponse>(
          { memberId: target.userId, roleKey: 'admin', clientRequestId: `chrole-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const unchanged = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: target.userId } });
        ctx.expect.eq(unchanged?.roleKey, 'member', 'the target role was not changed by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
