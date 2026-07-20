import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/customTask/v1` — the realtime custom-AI-task
//? save/delete/run write (FREEDOM_PROGRAM E5, `workTickets` capability, via
//? `dispatchControlSync`). Happy path exercises `save-custom-task` and asserts the real
//? Prisma post-condition on `customAiTask`; plus the RBAC boundary for a
//? non-`WorkspaceMember`.

type CustomTaskOp = 'save-custom-task' | 'delete-custom-task' | 'run-custom-task';
interface CustomTaskInput {
  op: CustomTaskOp;
  taskId?: string;
  name?: string;
  promptTemplate?: string;
  vars?: Record<string, string>;
  clientRequestId: string;
}
interface CustomTaskOk {
  status: 'success';
}
interface CustomTaskErr {
  status: 'error';
  errorCode: string;
}
type CustomTaskResponse = CustomTaskOk | CustomTaskErr;

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
    name: 'happy path (save-custom-task) creates a task (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'customtask_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const name = `Sync harness task ${String(Date.now())}`;
        const res = await ctx.callSync<CustomTaskInput, CustomTaskResponse>(
          { op: 'save-custom-task', name, promptTemplate: 'Summarize {{topic}}', clientRequestId: `ct-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'customTask save-custom-task returns status "success"');

        const task = await poll(() => ctx.prisma.customAiTask.findFirst({ where: { workspaceId, name } }));
        ctx.expect.ok(task !== null, 'the Conductor persisted the custom task (post-condition, not just the ack)');
        ctx.expect.eq(task?.promptTemplate, 'Summarize {{topic}}', 'the task was created with the requested prompt template');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'customtask_c2');
      const outsider = await createRealUser(ctx.prisma, 'customtask_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const name = `Should not be created ${String(Date.now())}`;
        const res = await ctx.callSync<CustomTaskInput, CustomTaskResponse>(
          { op: 'save-custom-task', name, promptTemplate: 'Should not persist', clientRequestId: `ct-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const task = await ctx.prisma.customAiTask.findFirst({ where: { workspaceId, name } });
        ctx.expect.ok(task === null, 'no custom task was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
