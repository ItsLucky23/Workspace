import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/styleExport/v1` — export a workspace's user-authored
//? (non-builtin) styles as a portable JSON set. The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't reach:
//?  [1] a seeded user-authored style appears in the exported set; builtin globals do not.
//?  [2] a non-member of the workspace is rejected with `auth.forbidden`.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) and seeds a
//? demo workspace (login alone no longer seeds one — first-login auto-seed was removed in
//? commit 42632a2). The style rows are written directly via `ctx.prisma.stylePreset`. Teardown
//? via the shared `cleanupWorkspace` helper.

interface StyleExportOk {
  status: 'success';
  result: { styles: string };
}
interface StyleExportErr {
  status: 'error';
  errorCode?: string;
}
type StyleExportResponse = StyleExportOk | StyleExportErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a seeded user-authored style is exported, a builtin one is not',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'styleexp_c1');
      try {
        await ctx.prisma.stylePreset.create({
          data: { workspaceId, feature: 'image-gen', key: 'noir', label: 'Noir', systemPrompt: 'black and white, high contrast', builtin: false },
        });
        await ctx.prisma.stylePreset.create({
          data: { workspaceId, feature: 'image-gen', key: 'builtin-one', label: 'Builtin', systemPrompt: 'should not export', builtin: true },
        });

        const res = await ctx.callApi<{ workspaceId: string }, StyleExportResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'styleExport returns status "success"');
        if (res.status !== 'success') return;
        const entries = JSON.parse(res.result.styles) as { feature: string; key: string; label: string }[];
        ctx.expect.ok(Array.isArray(entries), 'result.styles parses as an array');
        const noir = entries.find((e) => e.key === 'noir');
        ctx.expect.ok(noir !== undefined, 'the seeded non-builtin "noir" style is present');
        const builtin = entries.find((e) => e.key === 'builtin-one');
        ctx.expect.ok(builtin === undefined, 'the seeded builtin style is NOT present');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a non-member of the workspace is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'styleexp_c2_owner');
      const outsider = await createRealUser(ctx.prisma, 'styleexp_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string }, StyleExportResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'error', 'styleExport returns status "error" for a non-member');
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'auth.forbidden',
          `errorCode is "auth.forbidden" (got ${res.status === 'error' ? String(res.errorCode) : res.status})`,
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [ownerId, outsider.id]);
      }
    },
  },
];
