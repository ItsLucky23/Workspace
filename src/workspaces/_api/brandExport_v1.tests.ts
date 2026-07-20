import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import { tryCatch } from '@luckystack/core';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/brandExport/v1` — export the workspace brand library as a
//? portable JSON kit. The auto-sweep already covers contract/auth/rate-limit/fuzz; these cases
//? assert the business-logic the sweep can't reach:
//?  [1] a seeded brand library exports as a parseable JSON kit carrying its fields.
//?  [2] a non-member of the workspace is rejected with `auth.forbidden`.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) and seeds a
//? demo workspace (login alone no longer seeds one — first-login auto-seed was removed in
//? commit 42632a2). The brand library row is written directly via `ctx.prisma.studioBrandLibrary`
//? so the export has something real to read. Teardown via the shared `cleanupWorkspace` helper.

interface BrandExportOk {
  status: 'success';
  result: { kit: string };
}
interface BrandExportErr {
  status: 'error';
  errorCode?: string;
}
type BrandExportResponse = BrandExportOk | BrandExportErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a seeded brand library exports as a parseable JSON kit',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'brandexp_c1');
      try {
        await ctx.prisma.studioBrandLibrary.create({
          data: {
            workspaceId,
            name: 'Acme Brand',
            palette: [{ name: 'Primary', hex: '#112233' }],
            typography: { heading: 'Inter', body: 'Inter' },
            voice: 'confident, concise',
            taglines: ['Ship faster'],
            logoIdeas: ['bolt icon'],
          },
        });

        const res = await ctx.callApi<{ workspaceId: string }, BrandExportResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'brandExport returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.ok(res.result.kit.length > 0, 'result.kit is a non-empty JSON string');
        const [parseErr, parsed] = await tryCatch(() => JSON.parse(res.result.kit) as { name?: string; voice?: string });
        ctx.expect.ok(!parseErr, 'result.kit parses as JSON');
        if (parseErr || !parsed) return;
        ctx.expect.eq(parsed.name, 'Acme Brand', 'kit.name carries the seeded brand name');
        ctx.expect.eq(parsed.voice, 'confident, concise', 'kit.voice carries the seeded voice');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a non-member of the workspace is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'brandexp_c2_owner');
      const outsider = await createRealUser(ctx.prisma, 'brandexp_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string }, BrandExportResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'error', 'brandExport returns status "error" for a non-member');
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
