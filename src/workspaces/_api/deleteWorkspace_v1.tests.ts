import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/deleteWorkspace/v1` — the owner-only control-API
//? route that enqueues `delete-workspace` (cascade-deletes every tenant row). The
//? auto-sweep already covers contract/auth/rate-limit/fuzz; these cases assert the
//? business-logic the sweep can't reach:
//?  [1] the owner deleting their own workspace actually cascades — the Workspace row
//?      and its members are gone afterward (real Conductor execution, not a mock).
//?  [2] a non-member caller is rejected with `auth.forbidden` and the workspace
//?      survives untouched (the `CAP.ownerActions` RBAC gate).
//?
//? Integration test: `loginSeededUser` creates a real `User` + seeds a demo workspace
//? (owner role has every capability, incl. `ownerActions`) so case [1] has a real
//? tenant to delete. Case [2] adds a SECOND real user with no membership. Teardown:
//? case [1] deletes the workspace itself (asserted), so only the extra users are
//? cleaned up directly; case [2] uses `cleanupWorkspace` since the workspace survives.

interface DeleteOk {
  status: 'success';
  result: { accepted: true; signalSeq: number };
}
interface DeleteErr {
  status: 'error';
  errorCode: string;
}
type DeleteResponse = DeleteOk | DeleteErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'the owner deleting their workspace cascades the Workspace row away',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'deleteWs_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string; clientRequestId: string }, DeleteResponse>({
          workspaceId,
          clientRequestId: `deletews-${String(Date.now())}`,
        });
        ctx.expect.ok(res.status === 'success', `deleteWorkspace returns status "success" (got ${res.status === 'error' ? res.errorCode : 'success'})`);
        if (res.status !== 'success') return;
        const row = await ctx.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
        ctx.expect.eq(row, null, 'the Workspace row no longer exists after the cascade');
        const members = await ctx.prisma.workspaceMember.count({ where: { workspaceId } });
        ctx.expect.eq(members, 0, 'no WorkspaceMember rows survive the cascade');
      } finally {
        //? The workspace itself is gone (asserted above) or the case bailed early — either way
        //? only the users need cleanup; `cleanupWorkspace` would 404 on an already-deleted workspace.
        await ctx.prisma.workspaceMember.deleteMany({ where: { workspaceId } }).catch(() => null);
        await ctx.prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => null);
        await ctx.prisma.user.delete({ where: { id: userId } }).catch(() => null);
      }
    },
  },
  {
    name: 'a non-member caller is forbidden and the workspace survives',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'deleteWs_c2_owner');
      const outsider = await createRealUser(ctx.prisma, 'deleteWs_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string; clientRequestId: string }, DeleteResponse>({
          workspaceId,
          clientRequestId: `deletews-forbidden-${String(Date.now())}`,
        });
        ctx.expect.eq(res.status, 'error', 'a non-member cannot delete the workspace');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', 'the error code is auth.forbidden');
        const row = await ctx.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
        ctx.expect.ok(row !== null, 'the workspace still exists after the forbidden attempt');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [ownerId, outsider.id]);
      }
    },
  },
];
