import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/sprintEdit/v1` — the realtime sprint activate/rename/(re)date
//? write (`manageSprints` capability, via `dispatchControlSync`). Happy path asserted via the
//? real Prisma post-condition; plus the RBAC boundary for a non-`WorkspaceMember`.

interface SprintEditInput {
  sprintId: string;
  name?: string;
  active?: boolean;
  startAt?: string;
  endAt?: string;
  clientRequestId: string;
}
interface SprintEditOk {
  status: 'success';
  sprint: { id: string; name: string } | null;
}
interface SprintEditErr {
  status: 'error';
  errorCode: string;
}
type SprintEditResponse = SprintEditOk | SprintEditErr;

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
    name: 'happy path renames + activates a sprint (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'sprintedit_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const original = await ctx.prisma.sprint.create({
          data: { workspaceId, projectId: project.id, name: `Sync harness sprint ${String(Date.now())}`, active: false },
        });
        const newName = `Renamed sprint ${String(Date.now())}`;
        const res = await ctx.callSync<SprintEditInput, SprintEditResponse>(
          { sprintId: original.id, name: newName, active: true, clientRequestId: `se-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'sprintEdit returns status "success"');

        const updated = await poll(() => ctx.prisma.sprint.findFirst({ where: { workspaceId, id: original.id, name: newName } }));
        ctx.expect.ok(updated !== null, 'the Conductor persisted the rename (post-condition, not just the ack)');
        ctx.expect.eq(updated?.active, true, 'the sprint was activated as requested');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'sprintedit_c2');
      const outsider = await createRealUser(ctx.prisma, 'sprintedit_c2_outsider');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const original = await ctx.prisma.sprint.create({
          data: { workspaceId, projectId: project.id, name: `Should not change ${String(Date.now())}`, active: false },
        });

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SprintEditInput, SprintEditResponse>(
          { sprintId: original.id, name: 'Hacked name', clientRequestId: `se-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const unchanged = await ctx.prisma.sprint.findFirst({ where: { workspaceId, id: original.id } });
        ctx.expect.eq(unchanged?.name, original.name, 'the sprint was not modified by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
