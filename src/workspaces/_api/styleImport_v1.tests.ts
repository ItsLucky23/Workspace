import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/styleImport/v1` — import a portable style-set JSON into a
//? workspace (upsert by feature+key, never touches builtin globals). The auto-sweep already
//? covers contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't
//? reach:
//?  [1] a valid style-set JSON upserts `StylePreset` rows (non-builtin) with the parsed fields.
//?  [2] a malformed JSON string is rejected with `style.invalidJson`, no rows written.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) and seeds a
//? demo workspace (login alone no longer seeds one — first-login auto-seed was removed in
//? commit 42632a2). Teardown via the shared `cleanupWorkspace` helper.

interface StyleImportOk {
  status: 'success';
  result: { imported: number };
}
interface StyleImportErr {
  status: 'error';
  errorCode?: string;
}
type StyleImportResponse = StyleImportOk | StyleImportErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a valid style-set JSON upserts a non-builtin StylePreset row',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'styleimp_c1');
      try {
        const styles = JSON.stringify([
          { feature: 'image-gen', key: 'pastel', label: 'Pastel', systemPrompt: 'soft pastel palette, gentle lighting' },
        ]);

        const res = await ctx.callApi<{ workspaceId: string; styles: string }, StyleImportResponse>({ workspaceId, styles });
        ctx.expect.eq(res.status, 'success', 'styleImport returns status "success"');
        ctx.expect.ok(res.status === 'success' && res.result.imported === 1, 'result.imported reports 1 style written');

        const row = await ctx.prisma.stylePreset.findFirst({ where: { workspaceId, feature: 'image-gen', key: 'pastel' } });
        ctx.expect.ok(row !== null, 'a StylePreset row exists for feature+key');
        if (!row) return;
        ctx.expect.eq(row.label, 'Pastel', 'the row.label matches the imported style');
        ctx.expect.eq(row.builtin, false, 'the imported row is never marked builtin');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a malformed JSON string is rejected with style.invalidJson',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'styleimp_c2');
      try {
        const res = await ctx.callApi<{ workspaceId: string; styles: string }, StyleImportResponse>({
          workspaceId,
          styles: '{not valid json',
        });
        ctx.expect.eq(res.status, 'error', 'styleImport returns status "error" for malformed JSON');
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'style.invalidJson',
          `errorCode is "style.invalidJson" (got ${res.status === 'error' ? String(res.errorCode) : res.status})`,
        );
        const rows = await ctx.prisma.stylePreset.findMany({ where: { workspaceId } });
        ctx.expect.eq(rows.length, 0, 'no StylePreset rows were written');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
