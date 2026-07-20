import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/brandImport/v1` — import a portable brand-kit JSON into the
//? workspace brand library (upsert). The auto-sweep already covers contract/auth/rate-limit/fuzz;
//? these cases assert the business-logic the sweep can't reach:
//?  [1] a valid kit JSON upserts `StudioBrandLibrary` with the parsed fields.
//?  [2] a malformed JSON string is rejected with `brand.invalidJson`, no row written.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) and seeds a
//? demo workspace (login alone no longer seeds one — first-login auto-seed was removed in
//? commit 42632a2). Teardown via the shared `cleanupWorkspace` helper.

interface BrandImportOk {
  status: 'success';
  result: { imported: true };
}
interface BrandImportErr {
  status: 'error';
  errorCode?: string;
}
type BrandImportResponse = BrandImportOk | BrandImportErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a valid kit JSON upserts the brand library with the parsed fields',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'brandimp_c1');
      try {
        const kit = JSON.stringify({
          name: 'Nova Brand',
          palette: [{ name: 'Accent', hex: '#ff00aa' }],
          typography: { heading: 'Poppins', body: 'Poppins' },
          voice: 'playful',
          taglines: ['Go Nova'],
          logoIdeas: ['star mark'],
        });

        const res = await ctx.callApi<{ workspaceId: string; kit: string }, BrandImportResponse>({ workspaceId, kit });
        ctx.expect.eq(res.status, 'success', 'brandImport returns status "success"');
        ctx.expect.ok(res.status === 'success' && res.result.imported, 'result.imported is true');

        const row = await ctx.prisma.studioBrandLibrary.findFirst({ where: { workspaceId } });
        ctx.expect.ok(row !== null, 'a StudioBrandLibrary row exists for the workspace');
        if (!row) return;
        ctx.expect.eq(row.name, 'Nova Brand', 'the row.name matches the imported kit');
        ctx.expect.eq(row.voice, 'playful', 'the row.voice matches the imported kit');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a malformed JSON string is rejected with brand.invalidJson',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'brandimp_c2');
      try {
        const res = await ctx.callApi<{ workspaceId: string; kit: string }, BrandImportResponse>({
          workspaceId,
          kit: '{not valid json',
        });
        ctx.expect.eq(res.status, 'error', 'brandImport returns status "error" for malformed JSON');
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'brand.invalidJson',
          `errorCode is "brand.invalidJson" (got ${res.status === 'error' ? String(res.errorCode) : res.status})`,
        );
        const row = await ctx.prisma.studioBrandLibrary.findFirst({ where: { workspaceId } });
        ctx.expect.ok(row === null, 'no StudioBrandLibrary row was written');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
