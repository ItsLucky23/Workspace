import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';
import type { PipelineStageCfg } from '../_data/types';

//? Per-route tests for `workspaces/saveStageConfig/v1` — persists the full editable
//? per-stage config, keyed by `[workspaceId, projectId, stageId]`. Requires editPipeline.
//?  [1] happy path — a field update (`customInstructions`) is persisted on the SEEDED
//?      pipeline stage (Prisma post-condition), and the ack echoes it via `stageConfigDelta`.
//?  [2] validation boundary — `cfg.projectId` not matching the top-level `projectId` is
//?      rejected with `sync.invalidRequest` (the route's own guard), and nothing changes.
//?
//? Note on the HTTP-harness ack shape: `ctx.callSync` posts to the `/sync/...` HTTP endpoint
//? (not the socket ack), which wraps a SUCCESSFUL route result under `result` — the route's
//? own `serverOutput` fields are NOT at the top level. An ERROR result is flattened instead.

interface SaveStageConfigInput {
  stageId: string;
  projectId: string;
  cfg: PipelineStageCfg;
  clientRequestId: string;
}
interface SaveStageConfigOk {
  status: 'success';
  result: { status: 'success'; stageConfig: PipelineStageCfg | null };
}
interface SaveStageConfigErr {
  status: 'error';
  errorCode: string;
}
type SaveStageConfigResponse = SaveStageConfigOk | SaveStageConfigErr;

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

function baseCfg(projectId: string, stageId: string): PipelineStageCfg {
  return {
    projectId,
    id: stageId,
    kind: 'code',
    name: 'Test stage',
    order: 0,
    aiEnabled: true,
    customInstructions: `updated instructions ${String(Date.now())}`,
    handoverPrompt: '',
    aiSkillIds: [],
    sourceIds: [],
    commands: [],
    tools: [],
    statuses: [],
    processes: [],
    visibleStageIds: [],
    modelCfg: { autoEscalate: false, base: { model: 'sonnet', effort: 'medium' }, rules: [] },
    hooks: {},
  };
}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path persists a field update on the seeded stage (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'savestagecfg_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
        ctx.expect.ok(project !== null, 'the seeded workspace has a project');
        const stage = await ctx.prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: project?.id } });
        ctx.expect.ok(stage !== null, 'the seeded project has a pipeline stage');
        if (!project || !stage) return;

        const cfg = baseCfg(project.id, stage.key);
        const res = await ctx.callSync<SaveStageConfigInput, SaveStageConfigResponse>(
          { stageId: stage.key, projectId: project.id, cfg, clientRequestId: `ssc-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'saveStageConfig returns status "success"');
        if (res.status === 'success') {
          ctx.expect.eq(res.result.stageConfig?.customInstructions, cfg.customInstructions, 'the ack echoes the updated customInstructions');
        }

        const updated = await poll(() => ctx.prisma.pipelineStage.findFirst({
          where: { workspaceId, projectId: project.id, key: stage.key, customInstructions: cfg.customInstructions },
        }));
        ctx.expect.ok(updated !== null, 'the Conductor persisted the updated customInstructions');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'cfg.projectId mismatching the top-level projectId is rejected (validation boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'savestagecfg_c2');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
        const stage = await ctx.prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: project?.id } });
        ctx.expect.ok(project !== null && stage !== null, 'the seeded workspace has a project + stage');
        if (!project || !stage) return;

        const before = await ctx.prisma.pipelineStage.findFirst({ where: { id: stage.id }, select: { customInstructions: true } });
        const cfg = baseCfg('mismatched-project-id', stage.key);
        const res = await ctx.callSync<SaveStageConfigInput, SaveStageConfigResponse>(
          { stageId: stage.key, projectId: project.id, cfg, clientRequestId: `ssc-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a cfg.projectId mismatch is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'sync.invalidRequest', "rejected with the route's own validation error");
        }

        const after = await ctx.prisma.pipelineStage.findFirst({ where: { id: stage.id }, select: { customInstructions: true } });
        ctx.expect.eq(after?.customInstructions, before?.customInstructions, 'the stage is unchanged for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
