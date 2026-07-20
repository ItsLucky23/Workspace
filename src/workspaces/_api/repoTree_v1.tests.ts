import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `workspaces/repoTree/v1` — list the linked repo's whole file tree for the
//? workspace-level Code browser. The auto-sweep already covers contract/auth/rate-limit/fuzz; these
//? cases assert the read behaviour the sweep can't reach:
//?  [1] with a linked repo → linked:true + every seeded file path present.
//?  [2] with no repo linked → linked:false (no throw).
//?
//? Integration: a throwaway first-login user (Owner, so it holds workTickets) drives the route; a REAL
//? bare repo is seeded into the workspace's first project via `initGreenfieldRepo` (the same helper the
//? greenfield flow uses), then the on-disk repo dir + every seeded row are torn down in a `finally`.
//?
//? Input shape (from `src/_sockets/apiTypes.generated.ts`):
//?   { workspaceId: string; projectId?: undefined | string }

import { rmSync } from 'node:fs';
import path from 'node:path';
import { initGreenfieldRepo } from '../../../server/git/repoStore';

interface TreeOk { status: 'success'; result: { linked: boolean; branch?: string; entries?: { path: string; size: number }[] } }
interface TreeErr { status: 'error'; errorCode?: string }
type TreeResponse = TreeOk | TreeErr;

const uniqueEmail = (tag: string): string => `lstest_repotree_${tag}_${String(Date.now())}_${String(Math.floor(Math.random() * 1e6))}@youcomm.nl`;

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
    name: 'with a linked repo, lists every file at the baseline branch',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login({ email: uniqueEmail('c1') });
      try {
        const workspaceId = await seededWorkspaceId(ctx, userId);
        ctx.expect.ok(workspaceId !== undefined, 'the first-login seed created a workspace');
        if (workspaceId === undefined) return;
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        ctx.expect.ok(project !== null, 'the seed created a project');
        if (!project) return;
        await initGreenfieldRepo(workspaceId, project.id, [
          { path: 'src/index.ts', content: 'export const x = 1;\n' },
          { path: 'README.md', content: '# Hi\n' },
        ]);
        const res = await ctx.callApi<{ workspaceId: string }, TreeResponse>({ workspaceId });
        ctx.expect.ok(res.status === 'success' && res.result.linked, 'result.linked is true once a repo is linked');
        const paths = res.status === 'success' ? (res.result.entries ?? []).map((e) => e.path) : [];
        ctx.expect.ok(
          paths.includes('src/index.ts') && paths.includes('README.md'),
          'every seeded file path is listed in the tree',
        );
      } finally {
        await cleanupUser(ctx.prisma, userId);
      }
    },
  },
  {
    name: 'with no repo linked, returns linked:false',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login({ email: uniqueEmail('c2') });
      try {
        const workspaceId = await seededWorkspaceId(ctx, userId);
        ctx.expect.ok(workspaceId !== undefined, 'the first-login seed created a workspace');
        if (workspaceId === undefined) return;
        const res = await ctx.callApi<{ workspaceId: string }, TreeResponse>({ workspaceId });
        ctx.expect.ok(
          res.status === 'success' && !res.result.linked,
          'a workspace with no linked repo reports linked:false (never a throw)',
        );
      } finally {
        await cleanupUser(ctx.prisma, userId);
      }
    },
  },
];
