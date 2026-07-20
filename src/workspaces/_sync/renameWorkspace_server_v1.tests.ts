import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/renameWorkspace/v1` — the realtime workspace-rename write.
//?  [1] happy path — an Owner renames the workspace; asserted via the REAL Prisma
//?      post-condition (the Conductor's single-writer persistence), not just the ack.
//?  [2] tenant/RBAC boundary — a user who is a room member but NOT a `WorkspaceMember`
//?      of this workspace is rejected with `auth.forbidden`, and the name is unchanged.

interface RenameWorkspaceInput {
  name: string;
  clientRequestId: string;
}
interface RenameOk {
  status: 'success';
  workspaceId: string;
  name: string;
}
interface RenameErr {
  status: 'error';
  errorCode: string;
}
type RenameResponse = RenameOk | RenameErr;

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
    name: 'happy path renames the workspace (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'renamews_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const name = `Renamed workspace ${String(Date.now())}`;
        const res = await ctx.callSync<RenameWorkspaceInput, RenameResponse>(
          { name, clientRequestId: `rw-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'renameWorkspace returns status "success"');

        const workspace = await poll(() => ctx.prisma.workspace.findFirst({ where: { id: workspaceId, name } }));
        ctx.expect.ok(workspace !== null, 'the Conductor persisted the new name (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'renamews_c2');
      const outsider = await createRealUser(ctx.prisma, 'renamews_c2_outsider');
      const before = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId }, select: { name: true } });
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const name = `Should not apply ${String(Date.now())}`;
        const res = await ctx.callSync<RenameWorkspaceInput, RenameResponse>(
          { name, clientRequestId: `rw-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const after = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId }, select: { name: true } });
        ctx.expect.eq(after?.name, before?.name, 'the workspace name is unchanged for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
