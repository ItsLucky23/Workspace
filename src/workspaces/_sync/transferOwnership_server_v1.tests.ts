import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/transferOwnership/v1` — transfers `Workspace.ownerId`
//? via the Conductor (op `transfer-ownership`, requires ownerActions): the target becomes
//? `owner`, the caller becomes `admin`.
//?  [1] happy path — owner transfers to a seeded demo member; asserted via the REAL
//?      Prisma post-conditions (`Workspace.ownerId` + both `WorkspaceMember.roleKey`s),
//?      not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and ownership is unchanged.

interface TransferOwnershipInput {
  memberId: string;
  clientRequestId: string;
}
interface TransferOwnershipOk {
  status: 'success';
  newOwnerId: string;
  previousOwnerId: string;
}
interface TransferOwnershipErr {
  status: 'error';
  errorCode: string;
}
type TransferOwnershipResponse = TransferOwnershipOk | TransferOwnershipErr;

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
    name: 'happy path transfers ownership to a seeded member (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'transferown_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const target = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: { not: userId } } });
        ctx.expect.ok(target !== null, 'demo seed provides at least one non-owner member to transfer to');
        if (!target) return;

        const res = await ctx.callSync<TransferOwnershipInput, TransferOwnershipResponse>(
          { memberId: target.userId, clientRequestId: `xferown-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'transferOwnership returns status "success"');

        const workspace = await poll(async () => {
          const row = await ctx.prisma.workspace.findUnique({ where: { id: workspaceId } });
          return row?.ownerId === target.userId ? row : null;
        });
        ctx.expect.ok(workspace !== null, 'the Conductor moved Workspace.ownerId to the new owner (post-condition, not just the ack)');

        const newOwnerMember = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: target.userId } });
        ctx.expect.eq(newOwnerMember?.roleKey, 'owner', 'the new owner\'s membership role is "owner"');
        const previousOwnerMember = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
        ctx.expect.eq(previousOwnerMember?.roleKey, 'admin', 'the previous owner\'s membership role is demoted to "admin"');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'transferown_c2');
      const outsider = await createRealUser(ctx.prisma, 'transferown_c2_outsider');
      try {
        const target = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: { not: userId } } });
        ctx.expect.ok(target !== null, 'demo seed provides at least one non-owner member to target');
        if (!target) return;

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<TransferOwnershipInput, TransferOwnershipResponse>(
          { memberId: target.userId, clientRequestId: `xferown-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const workspace = await ctx.prisma.workspace.findUnique({ where: { id: workspaceId } });
        ctx.expect.eq(workspace?.ownerId, userId, 'ownership was not transferred by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
