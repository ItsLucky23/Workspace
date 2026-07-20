import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser, loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveDevCommand/v1`. The route is a thin, typed
//? `workspaceSettings`-gated control edge; the Conductor performs the actual
//? `project-runtime-save` write (B-23, single-writer). Auto-sweep covers
//? contract/auth/rate-limit/fuzz; these cases assert:
//?  [1] a member with `workspaceSettings` capability saves devCommand/prodCommand/stack
//?      and the Conductor persists it onto the real `Project` row.
//?  [2] a non-member of the target workspace is rejected `auth.forbidden` (the RBAC
//?      boundary `dispatchControlSync` checks via `OP_CAPABILITY['project-runtime-save']`).
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) + logs in +
//? seeds a demo workspace/project (the `owner` role carries `workspaceSettings`). Teardown via
//? the shared `cleanupWorkspace` harness helper.

interface SaveDevCommandOk { status: 'success'; result: { ok: true } }
interface SaveDevCommandErr { status: 'error'; errorCode: string }
type SaveDevCommandResponse = SaveDevCommandOk | SaveDevCommandErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a member persists devCommand/prodCommand/stack onto the real Project row',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveDevCommand_c1');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
        ctx.expect.ok(project !== null, 'the seeded workspace has a project');
        if (!project) return;
        const res = await ctx.callApi<{ workspaceId: string; projectId: string; clientRequestId: string; devCommand: string; prodCommand?: string; stack?: string }, SaveDevCommandResponse>({
          workspaceId, projectId: project.id, clientRequestId: `savedevcmd-c1-${String(Date.now())}`,
          devCommand: 'npm run dev', prodCommand: 'npm run start', stack: 'node',
        });
        ctx.expect.eq(res.status, 'success', 'saveDevCommand returns status "success"');
        ctx.expect.ok(res.status === 'success' && res.result.ok, 'result.ok is true');
        const row = await ctx.prisma.project.findUnique({ where: { id: project.id }, select: { devCommand: true, prodCommand: true, stack: true } });
        ctx.expect.eq(row?.devCommand, 'npm run dev', 'the Conductor persisted devCommand');
        ctx.expect.eq(row?.prodCommand, 'npm run start', 'the Conductor persisted prodCommand');
        ctx.expect.eq(row?.stack, 'node', 'the Conductor persisted stack');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an empty devCommand clears the override to null (falls back to package.json scripts)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveDevCommand_c2');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
        ctx.expect.ok(project !== null, 'the seeded workspace has a project');
        if (!project) return;
        const res = await ctx.callApi<{ workspaceId: string; projectId: string; clientRequestId: string; devCommand: string }, SaveDevCommandResponse>({
          workspaceId, projectId: project.id, clientRequestId: `savedevcmd-c2-${String(Date.now())}`, devCommand: '   ',
        });
        ctx.expect.eq(res.status, 'success', 'saveDevCommand returns status "success"');
        const row = await ctx.prisma.project.findUnique({ where: { id: project.id }, select: { devCommand: true } });
        ctx.expect.eq(row?.devCommand, null, 'a whitespace-only devCommand is trimmed and stored as null');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a non-member of the target workspace is rejected auth.forbidden and the project is unchanged',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'saveDevCommand_c3_owner');
      const outsider = await createRealUser(ctx.prisma, 'saveDevCommand_c3_outsider');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId }, select: { id: true, devCommand: true } });
        ctx.expect.ok(project !== null, 'the seeded workspace has a project');
        if (!project) return;
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string; projectId: string; clientRequestId: string; devCommand: string }, SaveDevCommandResponse>({
          workspaceId, projectId: project.id, clientRequestId: `savedevcmd-c3-${String(Date.now())}`, devCommand: 'npm run dev',
        });
        ctx.expect.eq(res.status, 'error', 'a non-member is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', 'errorCode is auth.forbidden');
        const row = await ctx.prisma.project.findUnique({ where: { id: project.id }, select: { devCommand: true } });
        ctx.expect.eq(row?.devCommand, project.devCommand, "the project's devCommand is unchanged");
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [ownerId, outsider.id]);
      }
    },
  },
];
