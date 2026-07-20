import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/stageCreate/v1` — the realtime pipeline-stage-create write
//? (R1, `editPipeline` capability, via `dispatchControlSync`). Happy path asserted via the real
//? Prisma post-condition; plus the RBAC boundary for a non-`WorkspaceMember`.

interface StageCreateInput {
  key: string;
  name: string;
  kind?: string;
  projectId: string;
  clientRequestId: string;
}
interface StageCreateOk {
  status: 'success';
  stageConfig: { id: string; key: string } | null;
}
interface StageCreateErr {
  status: 'error';
  errorCode: string;
}
type StageCreateResponse = StageCreateOk | StageCreateErr;

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
    name: 'happy path creates a pipeline stage (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'stagecreate_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const key = `sync-stage-${String(Date.now())}`;
        const res = await ctx.callSync<StageCreateInput, StageCreateResponse>(
          { key, name: 'Sync harness stage', projectId: project.id, clientRequestId: `stc-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'stageCreate returns status "success"');

        const stage = await poll(() => ctx.prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: project.id, key } }));
        ctx.expect.ok(stage !== null, 'the Conductor persisted the stage (post-condition, not just the ack)');
        ctx.expect.eq(stage?.name, 'Sync harness stage', 'the stage was created with the requested name');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'stagecreate_c2');
      const outsider = await createRealUser(ctx.prisma, 'stagecreate_c2_outsider');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const key = `should-not-create-${String(Date.now())}`;
        const res = await ctx.callSync<StageCreateInput, StageCreateResponse>(
          { key, name: 'Should not be created', projectId: project.id, clientRequestId: `stc-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const stage = await ctx.prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: project.id, key } });
        ctx.expect.ok(stage === null, 'no stage was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
