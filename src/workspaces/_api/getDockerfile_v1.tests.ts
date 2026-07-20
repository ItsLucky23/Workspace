import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `workspaces/getDockerfile/v1` — read the persisted draft so the
//? review UI survives a reload. The auto-sweep covers contract/auth/rate-limit/fuzz; these
//? cases assert the read behaviour the sweep can't reach:
//?  [1] with no draft yet → ok = false, error "dockerfile.noDraft".
//?  [2] after a draft is written → ok = true, the exact bytes come back.
//?
//? Integration: `loginSeededUser` creates a real `User` (a genuine ObjectId — the
//? harness's synthetic `test-user-<ts>` fallback is NOT a valid ObjectId), logs in as
//? it (Owner, so it holds workspaceSettings), and explicitly seeds a demo workspace
//? (first-login auto-seed was removed in commit 42632a2, so login alone no longer
//? populates one). The draft is seeded via the same server helper the save route uses;
//? the draft file + every seeded row are torn down in a `finally`.

import { rmSync } from 'node:fs';
import path from 'node:path';
import { saveDockerfileDraft } from '../../../server/container/dockerfileDraft';
import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

interface GetOk { status: 'success'; result: { ok: boolean; dockerfile: string; error?: string } }
interface GetErr { status: 'error'; errorCode?: string }
type GetResponse = GetOk | GetErr;

const BASE_IMAGE = process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0';

async function cleanupRoute(ctx: TestContext, workspaceId: string, userId: string): Promise<void> {
  rmSync(path.join(process.cwd(), 'data', 'workspaces', workspaceId), { recursive: true, force: true });
  await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
}

export const customTests: CustomTestCase[] = [
  {
    name: 'with no draft yet, returns ok=false / dockerfile.noDraft',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'getdockerfile_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string }, GetResponse>({ workspaceId });
        ctx.expect.ok(
          res.status === 'success' && !res.result.ok && res.result.error === 'dockerfile.noDraft',
          'a workspace with no generated draft reports "dockerfile.noDraft"',
        );
      } finally {
        await cleanupRoute(ctx, workspaceId, userId);
      }
    },
  },
  {
    name: 'after a draft is written, returns ok=true with the exact bytes',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'getdockerfile_c2');
      try {
        //? R3-b — the draft is per-project; seed + read the workspace's first project's slot.
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        ctx.expect.ok(project !== null, 'the seed created a project');
        if (!project) return;
        const draft = `FROM ${BASE_IMAGE}\nRUN echo persisted\n`;
        const saved = saveDockerfileDraft(workspaceId, project.id, draft);
        ctx.expect.ok(saved.ok, 'seeding the draft via saveDockerfileDraft succeeds');
        const res = await ctx.callApi<{ workspaceId: string }, GetResponse>({ workspaceId });
        ctx.expect.ok(res.status === 'success' && res.result.ok, 'result.ok is true once a draft exists');
        ctx.expect.ok(
          res.status === 'success' && res.result.dockerfile.trim() === draft.trim(),
          'the persisted draft bytes are returned verbatim',
        );
      } finally {
        await cleanupRoute(ctx, workspaceId, userId);
      }
    },
  },
];
