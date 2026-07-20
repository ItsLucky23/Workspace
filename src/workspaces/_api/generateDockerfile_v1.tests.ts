import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/generateDockerfile/v1` — register-flow C: AI-authors a
//? project's `.workspaces/Dockerfile` from the linked repo's manifests. The auto-sweep already
//? covers contract/auth/rate-limit/fuzz; these cases assert what it can't reach:
//?  [1] missing `workspaceId` → `api.invalidRequest`.
//?  [2] a user with no workspace membership → `auth.forbidden` (the `workspaceSettings` gate).
//?  [3] an authorized member generating for a project with NO linked repo (the seeded demo
//?      project has never run register-flow step A, so no bare mirror exists on disk) → the
//?      route still returns `status: 'success'` with `result.ok === false,
//?      result.error === 'repo.notLinked'` — `generateDockerfile` short-circuits on an empty
//?      manifest tree BEFORE ever calling the AI provider, so this is deterministic and doesn't
//?      spend a real AI turn.
//?
//? Integration test: `loginSeededUser` creates a real `User` + seeds a demo workspace (with a
//? project that has no linked git repo). The forbidden case adds an unrelated `createRealUser`
//? who is never made a member. Teardown via `cleanupWorkspace` (+ a bare `user.delete` for the
//? extra non-member user).

interface GenerateOk {
  status: 'success';
  result: { ok: boolean; dockerfile: string; path?: string; error?: string };
}
interface GenerateErr {
  status: 'error';
  errorCode: string;
}
type GenerateResponse = GenerateOk | GenerateErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'missing workspaceId returns api.invalidRequest',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'gendockerfile_c1');
      try {
        const res = await ctx.callApi<{ workspaceId?: string }, GenerateResponse>({});
        ctx.expect.eq(res.status, 'error', 'missing workspaceId is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'api.invalidRequest', `errorCode is api.invalidRequest, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a user with no workspace membership is forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'gendockerfile_c2');
      const outsider = await createRealUser(ctx.prisma, 'gendockerfile_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string }, GenerateResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'error', 'non-member request is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', `errorCode is auth.forbidden, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await ctx.prisma.user.delete({ where: { id: outsider.id } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an authorized member generating for a project with no linked repo gets repo.notLinked (no AI call)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'gendockerfile_c3');
      try {
        const res = await ctx.callApi<{ workspaceId: string }, GenerateResponse>({ workspaceId });
        ctx.expect.ok(res.status === 'success', `route returns status success, got ${res.status}`);
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.ok, false, 'generation did not run for an unlinked repo');
        ctx.expect.eq(res.result.error, 'repo.notLinked', 'error is repo.notLinked');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
