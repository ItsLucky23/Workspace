import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/designerGenerateTheme/v1` — AI theme generation from a brief. The
//? auto-sweep already covers contract/auth/rate-limit/fuzz; these cases assert the two guard branches
//? the route validates BEFORE ever reaching the AI provider (the actual generation call is
//? intentionally not exercised here — `runAiCompletion` depends on a live/configured AI provider not
//? guaranteed available in this harness, so asserting generation SUCCESS would not be deterministic;
//? per the harness convention this gap is documented rather than faked):
//?  [1] a blank/whitespace-only `prompt` is rejected with `api.invalidRequest`, before any
//?      workspace-membership lookup or AI call.
//?  [2] a logged-in user who is NOT a member of the target workspace is rejected with `auth.forbidden`.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) + seeds a demo
//? workspace for the membership fixture; case [2] additionally uses `createRealUser` for an outsider
//? account that never joins a workspace. Teardown via the shared `cleanupWorkspace` helper (plus a
//? direct `user.delete` for the outsider in case [2]).

interface GenerateThemeErr {
  status: 'error';
  errorCode?: string;
}
type GenerateThemeResponse = { status: 'success'; result: { name: string; description: string; light: unknown; dark: unknown } } | GenerateThemeErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a blank prompt is rejected with api.invalidRequest before any AI call',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'designertheme_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string; prompt: string }, GenerateThemeResponse>({
          workspaceId,
          prompt: '   ',
        });
        ctx.expect.eq(res.status, 'error', 'designerGenerateTheme rejects a blank prompt');
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
    name: 'a non-member of the workspace is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'designertheme_c2_owner');
      const outsider = await createRealUser(ctx.prisma, 'designertheme_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string; prompt: string }, GenerateThemeResponse>({
          workspaceId,
          prompt: 'a warm premium fintech look',
        });
        ctx.expect.eq(res.status, 'error', 'designerGenerateTheme rejects a non-member');
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
