import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { rmSync } from 'node:fs';
import path from 'node:path';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveDockerfile/v1` — persist the reviewed draft
//? `.workspaces/Dockerfile`. The auto-sweep covers contract/auth/rate-limit/fuzz; these
//? cases assert the business rule the sweep can't reach:
//?  [1] a valid draft (first FROM = the L1 base) is accepted (result.ok = true).
//?  [2] a draft whose first FROM is NOT the base is REJECTED (ok = false, invalidBase) —
//?      the supply-chain guard that must survive user edits, not just generation.
//?  [3] an empty draft is rejected (ok = false, empty).
//?
//? Integration: `loginSeededUser` creates a real `User` (a genuine ObjectId — the
//? harness's synthetic `test-user-<ts>` fallback is NOT a valid ObjectId), logs in as
//? it (Owner, so it holds workspaceSettings), and explicitly seeds a demo workspace
//? (first-login auto-seed was removed in commit 42632a2, so login alone no longer
//? populates one). The draft file + every seeded row are torn down in a `finally`.

interface SaveOk { status: 'success'; result: { ok: boolean; error?: string } }
interface SaveErr { status: 'error'; errorCode?: string }
type SaveResponse = SaveOk | SaveErr;

//? The base the draft must extend — read from env so the test tracks a custom WS_BASE_IMAGE.
const BASE_IMAGE = process.env.WS_BASE_IMAGE ?? 'workspaces/base:0.1.0';

async function cleanupRoute(ctx: TestContext, workspaceId: string, userId: string): Promise<void> {
  //? Remove any draft.Dockerfile this test wrote under data/workspaces/<id>/, then the seeded rows.
  rmSync(path.join(process.cwd(), 'data', 'workspaces', workspaceId), { recursive: true, force: true });
  await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
}

export const customTests: CustomTestCase[] = [
  {
    name: 'a valid draft (first FROM = the L1 base) is accepted',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'savedockerfile_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string; dockerfile: string }, SaveResponse>({
          workspaceId, dockerfile: `FROM ${BASE_IMAGE}\nRUN echo ok\n`,
        });
        ctx.expect.eq(res.status, 'success', 'save returns status "success"');
        ctx.expect.ok(res.status === 'success' && res.result.ok, 'result.ok is true for a base-extending draft');
      } finally {
        await cleanupRoute(ctx, workspaceId, userId);
      }
    },
  },
  {
    name: 'a draft whose first FROM is not the base is rejected (invalidBase)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'savedockerfile_c2');
      try {
        const res = await ctx.callApi<{ workspaceId: string; dockerfile: string }, SaveResponse>({
          workspaceId, dockerfile: 'FROM ubuntu:22.04\nRUN echo nope\n',
        });
        ctx.expect.ok(res.status === 'success', 'route resolves (the rejection is in result, not a throw)');
        ctx.expect.ok(
          res.status === 'success' && !res.result.ok && res.result.error === 'dockerfile.invalidBase',
          'an arbitrary FROM is rejected with error "dockerfile.invalidBase"',
        );
      } finally {
        await cleanupRoute(ctx, workspaceId, userId);
      }
    },
  },
  {
    name: 'an empty draft is rejected (empty)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'savedockerfile_c3');
      try {
        const res = await ctx.callApi<{ workspaceId: string; dockerfile: string }, SaveResponse>({
          workspaceId, dockerfile: '   \n  ',
        });
        ctx.expect.ok(
          res.status === 'success' && !res.result.ok && res.result.error === 'dockerfile.empty',
          'a whitespace-only draft is rejected with error "dockerfile.empty"',
        );
      } finally {
        await cleanupRoute(ctx, workspaceId, userId);
      }
    },
  },
];
