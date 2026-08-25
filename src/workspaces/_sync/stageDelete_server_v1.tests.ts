import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/stageDelete/v1` — the realtime pipeline-stage-delete write
//? (R1, `editPipeline` capability, via `dispatchControlSync`). Happy path asserted via the real
//? Prisma post-condition; plus the RBAC boundary for a non-`WorkspaceMember`.

interface StageDeleteInput {
  stageId: string;
  projectId: string;
  clientRequestId: string;
}
interface StageDeleteOk {
  status: 'success';
}
interface StageDeleteErr {
  status: 'error';
  errorCode: string;
}
type StageDeleteResponse = StageDeleteOk | StageDeleteErr;

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

//? Same minimal shape the Conductor's own `stage-create` op builds — see
//? `server/orchestrator/conductor.ts` case 'stage-create'.
async function seedStage(prisma: TestContext['prisma'], workspaceId: string, projectId: string, key: string): Promise<{ id: string }> {
  return prisma.pipelineStage.create({
    data: {
      workspaceId, projectId, key, kind: 'code', name: 'Doomed stage', order: 999, aiEnabled: true, wipLimit: null,
      systemPrompt: '', customInstructions: '', handoverPrompt: '', definitionOfDone: '',
      sourceIds: ['summary'], commands: [], tools: [], statuses: [], processes: [], visibleStageIds: [],
      modelCfg: { autoEscalate: false, base: { model: 'sonnet', effort: 'medium' }, rules: [] },
      hooks: {},
    },
  });
}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path deletes a pipeline stage (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'stagedelete_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const key = `sync-stage-del-${String(Date.now())}`;
        const stage = await seedStage(ctx.prisma, workspaceId, project.id, key);

        const res = await ctx.callSync<StageDeleteInput, StageDeleteResponse>(
          { stageId: key, projectId: project.id, clientRequestId: `std-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'stageDelete returns status "success"');

        const gone = await poll(async () => {
          const found = await ctx.prisma.pipelineStage.findFirst({ where: { id: stage.id } });
          return found === null ? true : null;
        });
        ctx.expect.ok(gone === true, 'the Conductor deleted the stage (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'stagedelete_c2');
      const outsider = await createRealUser(ctx.prisma, 'stagedelete_c2_outsider');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const key = `sync-stage-keep-${String(Date.now())}`;
        const stage = await seedStage(ctx.prisma, workspaceId, project.id, key);

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<StageDeleteInput, StageDeleteResponse>(
          { stageId: key, projectId: project.id, clientRequestId: `std-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const stillThere = await ctx.prisma.pipelineStage.findFirst({ where: { id: stage.id } });
        ctx.expect.ok(stillThere !== null, 'the stage was not deleted by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
