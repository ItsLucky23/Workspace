import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/repoTree/v1` — list the linked repo's whole file tree for the
//? workspace-level Code browser. The auto-sweep already covers contract/auth/rate-limit/fuzz; these
//? cases assert the read behaviour the sweep can't reach:
//?  [1] with a linked repo → linked:true + every seeded file path present.
//?  [2] with no repo linked → linked:false (no throw).
//?
//? Integration: `loginSeededUser` creates a REAL `User` (genuine ObjectId — the harness's synthetic
//? `test-user-<ts>` fallback breaks `@db.ObjectId` queries) and explicitly seeds a demo workspace
//? (first-login auto-seed was removed in 42632a2). A REAL bare repo is seeded into the workspace's
//? first project via `initGreenfieldRepo`; teardown via the shared `cleanupWorkspace` helper plus an
//? on-disk rm of the workspace's data dir (the bare repo lives outside the DB).
//?
//? Input shape (from `src/_sockets/apiTypes.generated.ts`):
//?   { workspaceId: string; projectId?: undefined | string }

import { rmSync } from 'node:fs';
import path from 'node:path';
import { initGreenfieldRepo } from '../../../server/git/repoStore';

interface TreeOk { status: 'success'; result: { linked: boolean; branch?: string; entries?: { path: string; size: number }[] } }
interface TreeErr { status: 'error'; errorCode?: string }
type TreeResponse = TreeOk | TreeErr;

async function firstProjectId(ctx: TestContext, workspaceId: string): Promise<string | null> {
  const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
  return project?.id ?? null;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'with a linked repo, lists every file at the baseline branch',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'repotree_c1');
      try {
        const projectId = await firstProjectId(ctx, workspaceId);
        ctx.expect.ok(projectId !== null, 'the seeded workspace has a project');
        if (projectId === null) return;
        await initGreenfieldRepo(workspaceId, projectId, [
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
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
        rmSync(path.join(process.cwd(), 'data', 'workspaces', workspaceId), { recursive: true, force: true });
      }
    },
  },
  {
    name: 'with no repo linked, returns linked:false',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'repotree_c2');
      try {
        const res = await ctx.callApi<{ workspaceId: string }, TreeResponse>({ workspaceId });
        ctx.expect.ok(
          res.status === 'success' && !res.result.linked,
          'a workspace with no linked repo reports linked:false (never a throw)',
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
        rmSync(path.join(process.cwd(), 'data', 'workspaces', workspaceId), { recursive: true, force: true });
      }
    },
  },
];
