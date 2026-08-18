import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/pipelinePreset/v1` — applying a pipeline preset to an EXISTING
//? project (owner decision 2026-08-18), via `dispatchControlSync` → the Conductor (B-23 single writer).
//? The auto-sweep covers contract validation, auth enforcement and fuzz. These cover the two things it
//? cannot infer, both of which are about NOT destroying work:
//?  [1] `fill` writes the blueprint into an EMPTY field and leaves a filled one alone. Overwriting is
//?      the failure mode that makes the feature unusable — a user who tuned six stages and lost them to
//?      one menu click never touches it again.
//?  [2] `switch` moves the tickets out of a stage BEFORE deleting it. A ticket pointing at a deleted
//?      column is not an error anywhere; it simply stops appearing on the board, which is the worst
//?      shape of data loss because nothing reports it.

interface PresetInput {
  projectId: string;
  preset: string;
  mode?: 'fill' | 'switch';
  clientRequestId: string;
}
interface PresetOk { status: 'success' }
interface PresetErr { status: 'error'; errorCode: string }
type PresetResponse = PresetOk | PresetErr;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T | null>, timeoutMs = 6000, stepMs = 50): Promise<T | null> {
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
    name: 'fill writes the blueprint into a blank stage and never overwrites a filled one',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'pipelinepreset_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');

        //? Blank the review stage the way a pre-blueprint seed (or a hand-added stage) leaves it, and
        //? put a sentinel in the implementation stage — the two halves of the assertion.
        const SENTINEL = 'MINE — do not touch';
        await ctx.prisma.pipelineStage.updateMany({ where: { workspaceId, projectId: project.id, key: 'review' }, data: { systemPrompt: '', customInstructions: '' } });
        await ctx.prisma.pipelineStage.updateMany({ where: { workspaceId, projectId: project.id, key: 'impl' }, data: { customInstructions: SENTINEL } });

        const res = await ctx.callSync<PresetInput, PresetResponse>(
          { projectId: project.id, preset: 'professional', mode: 'fill', clientRequestId: `pp-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'pipelinePreset returns status "success"');

        const filled = await poll(async () => {
          const stage = await ctx.prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: project.id, key: 'review' } });
          return stage && stage.customInstructions.trim().length > 0 ? stage : null;
        });
        ctx.expect.ok(filled !== null, 'the Conductor filled the blank review stage (post-condition, not just the ack)');
        ctx.expect.ok((filled?.systemPrompt ?? '').trim().length > 0, '…including its persona, which is the layer the PTY agent actually receives');

        const untouched = await ctx.prisma.pipelineStage.findFirst({ where: { workspaceId, projectId: project.id, key: 'impl' } });
        ctx.expect.eq(untouched?.customInstructions, SENTINEL, 'a field the user had already filled in is left exactly as it was');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'switch adds the preset stages, drops the rest and moves their tickets back',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'pipelinepreset_c2');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');

        //? A ticket parked in a stage the target preset does NOT have. `simple` keeps unrefined → impl →
        //? final, so this ticket must land on `impl`: the nearest earlier stage that survives, never a
        //? stage it has not passed through.
        const key = `PP-${String(Date.now())}`;
        await ctx.prisma.ticket.create({
          data: { workspaceId, projectId: project.id, key, number: 0, title: 'preset switch fixture', stageId: 'review', status: 'idle', labels: [] },
        });

        const res = await ctx.callSync<PresetInput, PresetResponse>(
          { projectId: project.id, preset: 'simple', mode: 'switch', clientRequestId: `pp-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'pipelinePreset returns status "success"');

        const settled = await poll(async () => {
          const stages = await ctx.prisma.pipelineStage.findMany({ where: { workspaceId, projectId: project.id }, select: { key: true } });
          return stages.some((s) => s.key === 'review') ? null : stages;
        });
        ctx.expect.ok(settled !== null, 'the Conductor dropped the stages the simple preset does not have');
        const keys = new Set((settled ?? []).map((s) => s.key));
        for (const wanted of ['unrefined', 'impl', 'final']) ctx.expect.ok(keys.has(wanted), `${wanted} survives the switch`);
        for (const gone of ['refined', 'plan', 'test', 'review']) ctx.expect.ok(!keys.has(gone), `${gone} is gone`);

        const moved = await ctx.prisma.ticket.findFirst({ where: { workspaceId, key } });
        ctx.expect.eq(moved?.stageId, 'impl', 'the ticket moved to the nearest surviving earlier stage instead of pointing at a deleted column');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'pipelinepreset_c3');
      const outsider = await createRealUser(ctx.prisma, 'pipelinepreset_out');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);

        const res = await ctx.callSync<PresetInput, PresetResponse>(
          { projectId: project.id, preset: 'simple', mode: 'switch', clientRequestId: `pp-c3-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'an outsider cannot rewrite someone else’s pipeline');

        //? And the pipeline is untouched — a rejected destructive op that still deleted half the board
        //? would be the worst possible outcome of getting the gate wrong.
        const stages = await ctx.prisma.pipelineStage.findMany({ where: { workspaceId, projectId: project.id }, select: { key: true } });
        ctx.expect.ok(stages.some((s) => s.key === 'review'), 'the stages the rejected switch would have dropped are still there');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
