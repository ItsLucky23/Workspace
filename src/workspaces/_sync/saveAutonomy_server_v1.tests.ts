import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveAutonomy/v1` — persists the workspace's autonomy
//? level (FREEDOM_PROGRAM A4). An unknown level falls back to the safe `gate-key-stages` default.
//?  [1] happy path — a valid level ('full-auto') is persisted (Prisma post-condition).
//?  [2] tenant/RBAC boundary — a room member without a `WorkspaceMember` row is rejected
//?      with `auth.forbidden`, and `autonomyLevel` is unchanged.
//?
//? Note on the HTTP-harness ack shape: `ctx.callSync` posts to the `/sync/...` HTTP endpoint
//? (not the socket ack), which wraps a SUCCESSFUL route result under `result` — the route's
//? own `serverOutput` fields are NOT at the top level. An ERROR result is flattened instead.

interface SaveAutonomyInput {
  autonomyLevel: string;
  clientRequestId: string;
}
interface SaveAutonomyOk {
  status: 'success';
  result: { status: 'success'; autonomyLevel: string };
}
interface SaveAutonomyErr {
  status: 'error';
  errorCode: string;
}
type SaveAutonomyResponse = SaveAutonomyOk | SaveAutonomyErr;

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
    name: 'happy path persists a valid autonomy level (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveautonomy_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SaveAutonomyInput, SaveAutonomyResponse>(
          { autonomyLevel: 'full-auto', clientRequestId: `sa-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'saveAutonomy returns status "success"');
        if (res.status === 'success') ctx.expect.eq(res.result.autonomyLevel, 'full-auto', 'the ack echoes the stored level');

        const workspace = await poll(() => ctx.prisma.workspace.findFirst({ where: { id: workspaceId, autonomyLevel: 'full-auto' } }));
        ctx.expect.ok(workspace !== null, 'the Conductor persisted the new autonomy level');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveautonomy_c2');
      const outsider = await createRealUser(ctx.prisma, 'saveautonomy_c2_outsider');
      const before = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId }, select: { autonomyLevel: true } });
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SaveAutonomyInput, SaveAutonomyResponse>(
          { autonomyLevel: 'full-auto', clientRequestId: `sa-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const after = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId }, select: { autonomyLevel: true } });
        ctx.expect.eq(after?.autonomyLevel, before?.autonomyLevel, 'autonomyLevel is unchanged for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
