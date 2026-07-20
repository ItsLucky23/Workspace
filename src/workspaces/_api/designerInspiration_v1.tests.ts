import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/designerInspiration/v1` — inspiration import ops (discover /
//? inspire-url / inspire-image / compare). The auto-sweep already covers contract/auth/rate-limit/
//? fuzz; these cases assert the two guard branches the route validates BEFORE ever reaching the AI/
//? capture layer (the actual `discoverReferenceSites`/screenshot/vision calls are intentionally not
//? exercised here — they depend on a live/configured AI provider + chromium container not guaranteed
//? available in this harness, so asserting a discover/capture SUCCESS would not be deterministic; per
//? the harness convention this gap is documented rather than faked):
//?  [1] `op: 'discover'` with a blank `query` is rejected with `api.invalidRequest`, before any AI call.
//?  [2] a logged-in user who is NOT a member of the target workspace is rejected with `auth.forbidden`
//?      on the non-'compare' membership-check branch.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) + seeds a demo
//? workspace for the membership fixture; case [2] additionally uses `createRealUser` for an outsider
//? account that never joins a workspace. Teardown via the shared `cleanupWorkspace` helper (plus a
//? direct `user.delete` for the outsider in case [2]).

interface InspirationErr {
  status: 'error';
  errorCode?: string;
}
type InspirationResponse = { status: 'success'; result: unknown } | InspirationErr;

export const customTests: CustomTestCase[] = [
  {
    name: "op:'discover' with a blank query is rejected with api.invalidRequest before any AI call",
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'designerinsp_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string; op: string; query: string }, InspirationResponse>({
          workspaceId,
          op: 'discover',
          query: '   ',
        });
        ctx.expect.eq(res.status, 'error', 'designerInspiration rejects a blank discover query');
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'api.invalidRequest',
          `errorCode is "api.invalidRequest" (got ${res.status === 'error' ? String(res.errorCode) : res.status})`,
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a non-member of the workspace is rejected with auth.forbidden on a non-compare op',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'designerinsp_c2_owner');
      const outsider = await createRealUser(ctx.prisma, 'designerinsp_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string; op: string; query: string }, InspirationResponse>({
          workspaceId,
          op: 'discover',
          query: 'fintech dashboards',
        });
        ctx.expect.eq(res.status, 'error', 'designerInspiration rejects a non-member');
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'auth.forbidden',
          `errorCode is "auth.forbidden" (got ${res.status === 'error' ? String(res.errorCode) : res.status})`,
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [ownerId]);
        await ctx.prisma.user.delete({ where: { id: outsider.id } });
      }
    },
  },
];
