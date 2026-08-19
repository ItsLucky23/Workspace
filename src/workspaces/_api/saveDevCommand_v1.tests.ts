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
    //? ADR 0317 — the runtime is a LIST, and this is the case the owner hit: edits that appeared not to
    //? save. The route/Conductor half is proven here against the real Project row, so a future "it does
    //? not save" report can be answered with evidence rather than a guess about which layer dropped it.
    name: 'runProcesses persists as a list, and previewProcessId is corrected to a process that exists',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveDevCommand_c4');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
        if (!project) throw new Error('seeded workspace has no project');
        const processes = [
          { id: 'fe', name: 'frontend', cwd: '', env: [], commands: ['npm run client'] },
          { id: 'be', name: 'backend', cwd: 'server', env: [{ key: 'PORT', value: '4787' }], commands: ['npm run server'] },
          //? An unfinished editor row. It must not become a stored process, or the ticket grows a
          //? terminal tab attached to a log nothing ever writes.
          { id: 'blank', name: 'wip', cwd: '', env: [], commands: ['   '] },
        ];
        const res = await ctx.callApi<{ workspaceId: string; projectId: string; clientRequestId: string; devCommand: string; runProcesses: typeof processes; previewProcessId: string }, SaveDevCommandResponse>({
          workspaceId, projectId: project.id, clientRequestId: `savedevcmd-c4-${String(Date.now())}`,
          devCommand: 'npm run client', runProcesses: processes, previewProcessId: 'be',
        });
        ctx.expect.eq(res.status, 'success', 'saveDevCommand accepts a process list');

        const row = await ctx.prisma.project.findUnique({ where: { id: project.id }, select: { runProcesses: true, previewProcessId: true } });
        ctx.expect.eq(row?.runProcesses.length, 2, 'both real processes persisted — and the empty row did not');
        ctx.expect.eq(row?.runProcesses[1]?.name, 'backend', 'order is preserved (it is the order they start in)');
        ctx.expect.eq(row?.runProcesses[1]?.env[0]?.value, '4787', 'per-process env survives the round trip');
        ctx.expect.eq(row?.previewProcessId, 'be', 'the chosen preview process is stored');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    //? The id the client sent names a row it had already deleted — the state a UI bug leaves behind.
    //? Storing it verbatim would leave the preview proxying nothing while the container looks healthy.
    name: 'a previewProcessId naming no process is corrected to the first one, not stored as-is',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveDevCommand_c5');
      try {
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
        if (!project) throw new Error('seeded workspace has no project');
        const processes = [{ id: 'only', name: 'app', cwd: '', env: [], commands: ['npm run dev'] }];
        await ctx.callApi<{ workspaceId: string; projectId: string; clientRequestId: string; devCommand: string; runProcesses: typeof processes; previewProcessId: string }, SaveDevCommandResponse>({
          workspaceId, projectId: project.id, clientRequestId: `savedevcmd-c5-${String(Date.now())}`,
          devCommand: 'npm run dev', runProcesses: processes, previewProcessId: 'deleted-row',
        });
        const row = await ctx.prisma.project.findUnique({ where: { id: project.id }, select: { previewProcessId: true } });
        ctx.expect.eq(row?.previewProcessId, 'only', 'an unknown preview id is corrected on write');
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
