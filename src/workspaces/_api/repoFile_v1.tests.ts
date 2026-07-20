import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/repoFile/v1` — read one file's content from the linked repo for the
//? Code browser's preview. The auto-sweep already covers contract/auth/rate-limit/fuzz; these cases
//? assert the behaviour the sweep can't reach:
//?  [1] a real seeded file → ok:true with the exact bytes back.
//?  [2] a traversal path (`..`) → ok:false / error "repo.invalidPath" (the path guard holds through the route).
//?
//? Integration: `loginSeededUser` creates a REAL `User` (genuine ObjectId — the harness's synthetic
//? `test-user-<ts>` fallback breaks `@db.ObjectId` queries) and explicitly seeds a demo workspace
//? (first-login auto-seed was removed in 42632a2). A REAL bare repo is seeded into the workspace's
//? first project via `initGreenfieldRepo`; teardown via the shared `cleanupWorkspace` helper plus an
//? on-disk rm of the workspace's data dir (the bare repo lives outside the DB).
//?
//? Input shape (from `src/_sockets/apiTypes.generated.ts`):
//?   { workspaceId: string; projectId?: undefined | string; path: string }

import { rmSync } from 'node:fs';
import path from 'node:path';
import { initGreenfieldRepo } from '../../../server/git/repoStore';

interface FileOk { status: 'success'; result: { ok: boolean; content?: string; binary?: boolean; truncated?: boolean; error?: string } }
interface FileErr { status: 'error'; errorCode?: string }
type FileResponse = FileOk | FileErr;

async function firstProjectId(ctx: TestContext, workspaceId: string): Promise<string | null> {
  const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
  return project?.id ?? null;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'a seeded file returns ok=true with the exact bytes',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'repofile_c1');
      try {
        const projectId = await firstProjectId(ctx, workspaceId);
        ctx.expect.ok(projectId !== null, 'the seeded workspace has a project');
        if (projectId === null) return;
        const body = 'export const answer = 42;\n';
        await initGreenfieldRepo(workspaceId, projectId, [{ path: 'src/index.ts', content: body }]);
        const res = await ctx.callApi<{ workspaceId: string; path: string }, FileResponse>({ workspaceId, path: 'src/index.ts' });
        ctx.expect.ok(res.status === 'success' && res.result.ok, 'result.ok is true for a real file');
        ctx.expect.ok(res.status === 'success' && res.result.content === body, 'the exact file content comes back verbatim');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
        rmSync(path.join(process.cwd(), 'data', 'workspaces', workspaceId), { recursive: true, force: true });
      }
    },
  },
  {
    name: 'a traversal path is rejected with repo.invalidPath',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'repofile_c2');
      try {
        const projectId = await firstProjectId(ctx, workspaceId);
        ctx.expect.ok(projectId !== null, 'the seeded workspace has a project');
        if (projectId === null) return;
        await initGreenfieldRepo(workspaceId, projectId, [{ path: 'README.md', content: '# Hi\n' }]);
        const res = await ctx.callApi<{ workspaceId: string; path: string }, FileResponse>({ workspaceId, path: '../etc/passwd' });
        ctx.expect.ok(
          res.status === 'success' && !res.result.ok && res.result.error === 'repo.invalidPath',
          'a `..` traversal path is refused with repo.invalidPath (guard holds through the route)',
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
        rmSync(path.join(process.cwd(), 'data', 'workspaces', workspaceId), { recursive: true, force: true });
      }
    },
  },
];
