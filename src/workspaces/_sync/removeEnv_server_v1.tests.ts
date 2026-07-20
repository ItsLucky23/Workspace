import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/removeEnv/v1` — the realtime env-var delete write
//? (`dispatchControlSync` op `remove-env`, `CAP.workspaceSettings`). The auto-sweep does
//? not walk `_sync` routes, so these cases stand in for contract/auth coverage too:
//?  [1] happy path — an Owner deletes a pre-seeded env var; asserted via the REAL Prisma
//?      post-condition (the row is actually gone), not just the echoed ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and the row survives.

interface RemoveEnvInput {
  envId: string;
  clientRequestId: string;
}
interface RemoveEnvOk {
  status: 'success';
  removedEnvId: string;
}
interface RemoveEnvErr {
  status: 'error';
  errorCode: string;
}
type RemoveEnvResponse = RemoveEnvOk | RemoveEnvErr;

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
    name: 'happy path deletes the env var (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'removeenv_c1');
      try {
        const key = `REMOVEENV_C1_${String(Date.now())}`;
        const seeded = await ctx.prisma.envVar.create({
          data: { workspaceId, key, value: 'to-delete', secret: false },
        });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<RemoveEnvInput, RemoveEnvResponse>(
          { envId: seeded.id, clientRequestId: `re-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        //? Note: the HTTP sync transport wraps the route's own `{ status, removedEnvId }`
        //? return inside a `{ status: 'success', result: <routeOutput> }` envelope, so
        //? `res.status` here only proves the transport call didn't error — the real
        //? post-condition is the Prisma poll below (same convention as the quickAdd exemplar).
        ctx.expect.eq(res.status, 'success', 'removeEnv returns status "success"');

        const stillThere = await poll(() => ctx.prisma.envVar.findUnique({ where: { id: seeded.id } }), 4000, 50);
        ctx.expect.ok(stillThere === null, 'the Conductor deleted the row (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'removeenv_c2');
      const outsider = await createRealUser(ctx.prisma, 'removeenv_c2_outsider');
      try {
        const key = `REMOVEENV_C2_${String(Date.now())}`;
        const seeded = await ctx.prisma.envVar.create({
          data: { workspaceId, key, value: 'keep-me', secret: false },
        });
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<RemoveEnvInput, RemoveEnvResponse>(
          { envId: seeded.id, clientRequestId: `re-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const stillThere = await ctx.prisma.envVar.findUnique({ where: { id: seeded.id } });
        ctx.expect.ok(stillThere !== null, 'the env var was not deleted by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
