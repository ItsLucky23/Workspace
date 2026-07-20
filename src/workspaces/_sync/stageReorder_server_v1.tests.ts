import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import type { PrismaClient } from '@prisma/client';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/stageReorder/v1` — the realtime pipeline-stage-reorder write
//? (R1, `editPipeline` capability, via `dispatchControlSync`). Happy path asserted via the real
//? Prisma post-condition (both stages' `order` swapped); plus the RBAC boundary for a
//? non-`WorkspaceMember`.
//?
//? The Conductor requires `order` to contain EXACTLY the target project's existing stage keys
//? (`order.length !== existingKeys.size` fails as `stage.invalidOrder`), so each case seeds its
//? OWN dedicated project with exactly two stages — never reusing the seeded demo project, whose
//? full pipeline would need every key listed.

interface StageReorderInput {
  order: string[];
  projectId: string;
  clientRequestId: string;
}
interface StageReorderOk {
  status: 'success';
}
interface StageReorderErr {
  status: 'error';
  errorCode: string;
}
type StageReorderResponse = StageReorderOk | StageReorderErr;

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
async function seedStage(prisma: PrismaClient, workspaceId: string, projectId: string, key: string, order: number): Promise<{ id: string }> {
  return prisma.pipelineStage.create({
    data: {
      workspaceId, projectId, key, kind: 'code', name: `Stage ${key}`, order, aiEnabled: true, wipLimit: null,
      roleKey: 'code', systemPrompt: '', customInstructions: '', promptTemplate: '{{summary}}', definitionOfDone: '',
      skillKeys: [], sourceIds: ['summary'], commands: [], tools: [], statuses: [], processes: [], visibleStageIds: [],
      modelCfg: { autoEscalate: false, base: { model: 'sonnet', effort: 'medium', maxTurns: 20 }, rules: [] },
      network: { enabled: true, mode: 'whitelist', categories: ['package-registries', 'source-hosts', 'ai-apis'], domains: [] },
      hooks: {},
    },
  });
}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path persists the new stage order (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'stagereorder_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.create({ data: { workspaceId, name: 'Reorder test project', gitlabPath: '' } });
        const keyA = `stage-a-${String(Date.now())}`;
        const keyB = `stage-b-${String(Date.now())}`;
        await seedStage(ctx.prisma, workspaceId, project.id, keyA, 0);
        await seedStage(ctx.prisma, workspaceId, project.id, keyB, 1);

        const res = await ctx.callSync<StageReorderInput, StageReorderResponse>(
          { order: [keyB, keyA], projectId: project.id, clientRequestId: `str-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'stageReorder returns status "success"');

        const reordered = await poll(async () => {
          const first = await ctx.prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: project.id, key: keyB } });
          return first?.order === 0 ? first : null;
        });
        ctx.expect.ok(reordered !== null, 'the Conductor persisted the new order (post-condition, not just the ack)');
        const second = await ctx.prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: project.id, key: keyA } });
        ctx.expect.eq(second?.order, 1, 'the previously-first stage moved to order 1');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'stagereorder_c2');
      const outsider = await createRealUser(ctx.prisma, 'stagereorder_c2_outsider');
      try {
        const project = await ctx.prisma.project.create({ data: { workspaceId, name: 'Reorder RBAC project', gitlabPath: '' } });
        const keyA = `stage-a-${String(Date.now())}`;
        const keyB = `stage-b-${String(Date.now())}`;
        await seedStage(ctx.prisma, workspaceId, project.id, keyA, 0);
        await seedStage(ctx.prisma, workspaceId, project.id, keyB, 1);

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<StageReorderInput, StageReorderResponse>(
          { order: [keyB, keyA], projectId: project.id, clientRequestId: `str-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const unchanged = await ctx.prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: project.id, key: keyA } });
        ctx.expect.eq(unchanged?.order, 0, 'the order was not changed by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
