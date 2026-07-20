import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/buildProjectImage/v1` — register-flow C: builds the
//? AI-authored draft `.workspaces/Dockerfile` into the L2 per-project image. The auto-sweep
//? already covers contract/auth/rate-limit/fuzz; these cases assert what it can't reach:
//?  [1] missing `workspaceId` → `api.invalidRequest`.
//?  [2] a user with no workspace membership → `auth.forbidden` (the `workspaceSettings` gate).
//?  [3] an authorized member building for a project with no `.workspaces/Dockerfile` draft on
//?      disk (the seeded demo project never ran `generateDockerfile`/`saveDockerfile`) → the
//?      route always returns `status: 'success'` with `result.ok === false` and a non-empty
//?      `result.error`. `buildProjectImage` checks Docker availability BEFORE the draft, so the
//?      exact code (`docker.unavailable` vs `dockerfile.noDraft`) legitimately varies by
//?      environment — we assert the deterministic part of the contract (never builds, never
//?      succeeds) without depending on whether a Docker daemon happens to be running here.
//?
//? Integration test: `loginSeededUser` creates a real `User` + seeds a demo workspace (with a
//? project that has no Dockerfile draft). The forbidden case adds an unrelated `createRealUser`
//? who is never made a member. Teardown via `cleanupWorkspace` (+ a bare `user.delete` for the
//? extra non-member user).

interface BuildOk {
  status: 'success';
  result: { ok: boolean; tag?: string; error?: string };
}
interface BuildErr {
  status: 'error';
  errorCode: string;
}
type BuildResponse = BuildOk | BuildErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'missing workspaceId returns api.invalidRequest',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'buildimage_c1');
      try {
        const res = await ctx.callApi<{ workspaceId?: string }, BuildResponse>({});
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
      const { userId, workspaceId } = await loginSeededUser(ctx, 'buildimage_c2');
      const outsider = await createRealUser(ctx.prisma, 'buildimage_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string }, BuildResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'error', 'non-member request is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', `errorCode is auth.forbidden, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await ctx.prisma.user.delete({ where: { id: outsider.id } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an authorized member building a project with no Dockerfile draft never succeeds',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'buildimage_c3');
      try {
        const res = await ctx.callApi<{ workspaceId: string }, BuildResponse>({ workspaceId });
        ctx.expect.ok(res.status === 'success', `route returns status success, got ${res.status}`);
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.ok, false, 'build did not succeed without a draft Dockerfile');
        ctx.expect.ok((res.result.error ?? '').length > 0, `result.error is a non-empty diagnostic, got ${JSON.stringify(res.result.error)}`);
        ctx.expect.eq(res.result.tag, undefined, 'no image tag is produced');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
