import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveEnv/v1` — the realtime env-var upsert write
//? (`dispatchControlSync` op `save-env`, `CAP.workspaceSettings`). The auto-sweep does
//? not walk `_sync` routes, so these cases stand in for contract/auth coverage too:
//?  [1] happy path — an Owner upserts an env var; asserted via the REAL Prisma
//?      post-condition (the Conductor's single-writer persistence), not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and no row is created.

interface SaveEnvInput {
  key: string;
  value: string;
  secret: boolean;
  clientRequestId: string;
}
interface SaveEnvOk {
  status: 'success';
  envVar: { id: string; key: string } | null;
}
interface SaveEnvErr {
  status: 'error';
  errorCode: string;
}
type SaveEnvResponse = SaveEnvOk | SaveEnvErr;

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
    name: 'happy path upserts an env var (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveenv_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const key = `SAVEENV_C1_${String(Date.now())}`;
        const res = await ctx.callSync<SaveEnvInput, SaveEnvResponse>(
          { key, value: 'hello', secret: false, clientRequestId: `se-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'saveEnv returns status "success"');

        const envVar = await poll(() => ctx.prisma.envVar.findFirst({ where: { workspaceId, key } }));
        ctx.expect.ok(envVar !== null, 'the Conductor persisted the env var (post-condition, not just the ack)');
        ctx.expect.eq(envVar?.value, 'hello', 'the persisted value matches the input');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveenv_c2');
      const outsider = await createRealUser(ctx.prisma, 'saveenv_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const key = `SAVEENV_C2_${String(Date.now())}`;
        const res = await ctx.callSync<SaveEnvInput, SaveEnvResponse>(
          { key, value: 'nope', secret: false, clientRequestId: `se-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const envVar = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key } });
        ctx.expect.ok(envVar === null, 'no env var was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
