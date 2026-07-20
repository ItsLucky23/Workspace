import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/studioBrand/v1` — the central brand library (`save` upserts the
//? workspace brand, `promote` adopts a generated `brand` artifact into it). The auto-sweep already
//? covers contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't reach:
//?  [1] `op: 'save'` upserts `StudioBrandLibrary` with the given palette/voice/taglines.
//?  [2] `op: 'promote'` with an `artifactId` that isn't a `kind: 'brand'` StudioArtifact is rejected
//?      with `studio.notABrand`.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) and seeds a demo
//? workspace. Teardown via the shared `cleanupWorkspace` helper.

interface BrandSaveOk {
  status: 'success';
  result: { ok: true };
}
interface BrandErr {
  status: 'error';
  errorCode?: string;
}
type BrandResponse = BrandSaveOk | BrandErr;

export const customTests: CustomTestCase[] = [
  {
    name: "op:'save' upserts StudioBrandLibrary with the given palette/voice/taglines",
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'studiobrand_c1');
      try {
        const res = await ctx.callApi<{
          workspaceId: string; op: string;
          palette: { name: string; hex: string }[]; voice: string; taglines: string[];
        }, BrandResponse>({
          workspaceId,
          op: 'save',
          palette: [{ name: 'Accent', hex: '#ff00aa' }],
          voice: 'confident',
          taglines: ['Build faster'],
        });
        ctx.expect.eq(res.status, 'success', 'studioBrand save returns status "success"');
        ctx.expect.ok(res.status === 'success' && res.result.ok, 'result.ok is true');

        const row = await ctx.prisma.studioBrandLibrary.findFirst({ where: { workspaceId } });
        ctx.expect.ok(row !== null, 'a StudioBrandLibrary row exists for the workspace');
        if (!row) return;
        ctx.expect.eq(row.voice, 'confident', 'row.voice matches the saved input');
        ctx.expect.eq(row.taglines, ['Build faster'], 'row.taglines matches the saved input');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: "op:'promote' with an artifact that isn't kind:'brand' is rejected with studio.notABrand",
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'studiobrand_c2');
      try {
        const brief = await ctx.prisma.studioBrief.create({
          data: { workspaceId, name: 'Brief', productName: 'Nova', audience: 'devs', tone: 'confident', goals: 'grow' },
        });
        const artifact = await ctx.prisma.studioArtifact.create({
          data: { workspaceId, briefId: brief.id, kind: 'copy', role: 'marketer', title: 'Copy', content: { sections: [] }, status: 'ready' },
        });

        const res = await ctx.callApi<{ workspaceId: string; op: string; artifactId: string }, BrandResponse>({
          workspaceId,
          op: 'promote',
          artifactId: artifact.id,
        });
        ctx.expect.eq(res.status, 'error', 'studioBrand promote rejects a non-brand artifact');
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'studio.notABrand',
          `errorCode is "studio.notABrand" (got ${res.status === 'error' ? String(res.errorCode) : res.status})`,
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
