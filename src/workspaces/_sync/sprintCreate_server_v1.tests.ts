import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/sprintCreate/v1` — the realtime sprint-create write
//? (`manageSprints` capability, via `dispatchControlSync`). Same recipe as
//? `quickAdd_server_v1.tests.ts`: happy path asserted via the real Prisma post-condition
//? (never just the ack), plus the RBAC boundary for a non-`WorkspaceMember`.

interface SprintCreateInput {
  name: string;
  active?: boolean;
  clientRequestId: string;
}
interface SprintCreateOk {
  status: 'success';
  sprint: { id: string; name: string } | null;
}
interface SprintCreateErr {
  status: 'error';
  errorCode: string;
}
type SprintCreateResponse = SprintCreateOk | SprintCreateErr;

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
    name: 'happy path creates a sprint (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'sprintcreate_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const name = `Sync harness sprint ${String(Date.now())}`;
        const res = await ctx.callSync<SprintCreateInput, SprintCreateResponse>(
          { name, active: true, clientRequestId: `sc-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'sprintCreate returns status "success"');

        const sprint = await poll(() => ctx.prisma.sprint.findFirst({ where: { workspaceId, name } }));
        ctx.expect.ok(sprint !== null, 'the Conductor persisted the sprint (post-condition, not just the ack)');
        ctx.expect.eq(sprint?.active, true, 'the sprint was created active as requested');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'sprintcreate_c2');
      const outsider = await createRealUser(ctx.prisma, 'sprintcreate_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const name = `Should not be created ${String(Date.now())}`;
        const res = await ctx.callSync<SprintCreateInput, SprintCreateResponse>(
          { name, clientRequestId: `sc-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const sprint = await ctx.prisma.sprint.findFirst({ where: { workspaceId, name } });
        ctx.expect.ok(sprint === null, 'no sprint was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
