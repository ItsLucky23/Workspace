import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/cloneWorkspace/v1` — duplicates the source workspace's
//? configuration into a new workspace owned by the caller (GAP_SCAN G2, single-writer Conductor).
//?  [1] happy path — a new Workspace row is created, owned by the caller (Prisma post-condition).
//?  [2] tenant/RBAC boundary — a room member who is not a `WorkspaceMember` of the SOURCE
//?      workspace is rejected with `auth.forbidden`, and no new workspace is created.

interface CloneWorkspaceInput {
  name: string;
  clientRequestId: string;
}
interface CloneOk {
  status: 'success';
}
interface CloneErr {
  status: 'error';
  errorCode: string;
}
type CloneResponse = CloneOk | CloneErr;

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
    name: 'happy path creates a new owned workspace (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'clonews_c1');
      let clonedId: string | undefined;
      try {
        await joinRoom(ctx, workspaceId);
        const name = `Cloned workspace ${String(Date.now())}`;
        const res = await ctx.callSync<CloneWorkspaceInput, CloneResponse>(
          { name, clientRequestId: `cw-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'cloneWorkspace returns status "success"');

        const cloned = await poll(() => ctx.prisma.workspace.findFirst({ where: { name, ownerId: userId } }));
        ctx.expect.ok(cloned !== null, 'the Conductor persisted a new workspace owned by the caller');
        clonedId = cloned?.id;
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
        if (clonedId) await cleanupWorkspace(ctx.prisma, clonedId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row on the source is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'clonews_c2');
      const outsider = await createRealUser(ctx.prisma, 'clonews_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const name = `Should not be cloned ${String(Date.now())}`;
        const res = await ctx.callSync<CloneWorkspaceInput, CloneResponse>(
          { name, clientRequestId: `cw-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the source workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const cloned = await ctx.prisma.workspace.findFirst({ where: { name } });
        ctx.expect.ok(cloned === null, 'no new workspace was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
