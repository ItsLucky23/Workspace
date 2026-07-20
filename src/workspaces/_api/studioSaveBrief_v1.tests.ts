import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/studioSaveBrief/v1` — create or update a product/marketing brief.
//? The auto-sweep already covers contract/auth/rate-limit/fuzz; these cases assert the business-logic
//? the sweep can't reach:
//?  [1] no `id` creates a new `StudioBrief` row with the trimmed fields.
//?  [2] a blank `productName` is rejected with `api.invalidRequest`, no row created.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) and seeds a demo
//? workspace. Teardown via the shared `cleanupWorkspace` helper.

interface SaveBriefOk {
  status: 'success';
  result: { id: string };
}
interface SaveBriefErr {
  status: 'error';
  errorCode?: string;
}
type SaveBriefResponse = SaveBriefOk | SaveBriefErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'no id creates a new StudioBrief row with the trimmed fields',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'studiobrief_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string; name: string; productName: string; audience: string; tone: string; goals: string }, SaveBriefResponse>({
          workspaceId,
          name: '  Launch brief  ',
          productName: '  Nova  ',
          audience: 'developers',
          tone: 'confident',
          goals: 'grow signups',
        });
        ctx.expect.eq(res.status, 'success', 'studioSaveBrief returns status "success"');
        ctx.expect.ok(res.status === 'success' && res.result.id.length > 0, 'result.id is a non-empty string');
        if (res.status !== 'success') return;

        const row = await ctx.prisma.studioBrief.findFirst({ where: { workspaceId, id: res.result.id } });
        ctx.expect.ok(row !== null, 'a StudioBrief row exists for the returned id');
        if (!row) return;
        ctx.expect.eq(row.name, 'Launch brief', 'row.name is trimmed');
        ctx.expect.eq(row.productName, 'Nova', 'row.productName is trimmed');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a blank productName is rejected with api.invalidRequest, no row created',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'studiobrief_c2');
      try {
        const before = await ctx.prisma.studioBrief.count({ where: { workspaceId } });
        const res = await ctx.callApi<{ workspaceId: string; name: string; productName: string }, SaveBriefResponse>({
          workspaceId,
          name: 'Launch brief',
          productName: '   ',
        });
        ctx.expect.eq(res.status, 'error', 'studioSaveBrief rejects a blank productName');
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'api.invalidRequest',
          `errorCode is "api.invalidRequest" (got ${res.status === 'error' ? String(res.errorCode) : res.status})`,
        );
        const after = await ctx.prisma.studioBrief.count({ where: { workspaceId } });
        ctx.expect.eq(after, before, 'no StudioBrief row was created');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
