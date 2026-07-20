import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `workspaces/repoFile/v1` — read one file's content from the linked repo for the
//? Code browser's preview. The auto-sweep already covers contract/auth/rate-limit/fuzz; these cases
//? assert the behaviour the sweep can't reach:
//?  [1] a real seeded file → ok:true with the exact bytes back.
//?  [2] a traversal path (`..`) → ok:false / error "repo.invalidPath" (the path guard holds through the route).
//?
//? Integration: a throwaway first-login user (Owner, holds workTickets) drives the route; a REAL bare repo
//? is seeded into the workspace's first project via `initGreenfieldRepo`, then the repo dir + every seeded
//? row are torn down in a `finally`.
//?
//? Input shape (from `src/_sockets/apiTypes.generated.ts`):
//?   { workspaceId: string; projectId?: undefined | string; path: string }

import { rmSync } from 'node:fs';
import path from 'node:path';
import { initGreenfieldRepo } from '../../../server/git/repoStore';

interface FileOk { status: 'success'; result: { ok: boolean; content?: string; binary?: boolean; truncated?: boolean; error?: string } }
interface FileErr { status: 'error'; errorCode?: string }
type FileResponse = FileOk | FileErr;

const uniqueEmail = (tag: string): string => `lstest_repofile_${tag}_${String(Date.now())}_${String(Math.floor(Math.random() * 1e6))}@youcomm.nl`;

async function cleanupUser(db: TestContext['prisma'], userId: string): Promise<void> {
  const memberships = await db.workspaceMember.findMany({ where: { userId } });
  const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
  for (const workspaceId of workspaceIds) {
    const members = await db.workspaceMember.findMany({ where: { workspaceId } });
    const demoUserIds = members.map((m) => m.userId).filter((id) => id !== userId);
    await db.ticketEvent.deleteMany({ where: { workspaceId } });
    await db.ticket.deleteMany({ where: { workspaceId } });
    await db.workspaceSuggestion.deleteMany({ where: { workspaceId } });
    await db.workspaceBudget.deleteMany({ where: { workspaceId } });
    await db.workspaceSignal.deleteMany({ where: { workspaceId } });
    await db.sprint.deleteMany({ where: { workspaceId } });
    await db.infoSource.deleteMany({ where: { workspaceId } });
    await db.envVar.deleteMany({ where: { workspaceId } });
    await db.integrationTool.deleteMany({ where: { workspaceId } });
    await db.invite.deleteMany({ where: { workspaceId } });
    await db.pipelineStage.deleteMany({ where: { workspaceId } });
    await db.workspaceRole.deleteMany({ where: { workspaceId } });
    await db.workspaceMember.deleteMany({ where: { workspaceId } });
    await db.project.deleteMany({ where: { workspaceId } });
    await db.workspace.deleteMany({ where: { id: workspaceId } });
    rmSync(path.join(process.cwd(), 'data', 'workspaces', workspaceId), { recursive: true, force: true });
    if (demoUserIds.length > 0) await db.user.deleteMany({ where: { id: { in: demoUserIds } } });
  }
  await db.user.deleteMany({ where: { id: userId } });
}

async function seededWorkspaceId(ctx: TestContext, userId: string): Promise<string | undefined> {
  const member = await ctx.prisma.workspaceMember.findFirst({ where: { userId } });
  return member?.workspaceId;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'a seeded file returns ok=true with the exact bytes',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login({ email: uniqueEmail('c1') });
      try {
        const workspaceId = await seededWorkspaceId(ctx, userId);
        ctx.expect.ok(workspaceId !== undefined, 'the first-login seed created a workspace');
        if (workspaceId === undefined) return;
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        ctx.expect.ok(project !== null, 'the seed created a project');
        if (!project) return;
        const body = 'export const answer = 42;\n';
        await initGreenfieldRepo(workspaceId, project.id, [{ path: 'src/index.ts', content: body }]);
        const res = await ctx.callApi<{ workspaceId: string; path: string }, FileResponse>({ workspaceId, path: 'src/index.ts' });
        ctx.expect.ok(res.status === 'success' && res.result.ok, 'result.ok is true for a real file');
        ctx.expect.ok(res.status === 'success' && res.result.content === body, 'the exact file content comes back verbatim');
      } finally {
        await cleanupUser(ctx.prisma, userId);
      }
    },
  },
  {
    name: 'a traversal path is rejected with repo.invalidPath',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login({ email: uniqueEmail('c2') });
      try {
        const workspaceId = await seededWorkspaceId(ctx, userId);
        ctx.expect.ok(workspaceId !== undefined, 'the first-login seed created a workspace');
        if (workspaceId === undefined) return;
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) return;
        await initGreenfieldRepo(workspaceId, project.id, [{ path: 'README.md', content: '# Hi\n' }]);
        const res = await ctx.callApi<{ workspaceId: string; path: string }, FileResponse>({ workspaceId, path: '../etc/passwd' });
        ctx.expect.ok(
          res.status === 'success' && !res.result.ok && res.result.error === 'repo.invalidPath',
          'a `..` traversal path is refused with repo.invalidPath (guard holds through the route)',
        );
      } finally {
        await cleanupUser(ctx.prisma, userId);
      }
    },
  },
];
