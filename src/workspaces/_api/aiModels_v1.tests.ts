import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/aiModels/v1` (P4-4 — live model listing per connection). The
//? auto-sweep already covers contract/auth/rate-limit/fuzz; these cases assert what it can't reach:
//?  [1] tenant boundary — a connectionId that belongs to ANOTHER workspace (or does not exist) answers
//?      `ai.connectionNotFound`, never a list: the key is looked up by (workspaceId, connectionId).
//?  [2] a subscription backend (claude-cli) has no model concept → `ai.modelsUnsupported` (no network).
//?  [3] a caller with no membership on the target workspace → `auth.forbidden`.
//? The live `/models` HTTP call itself is NOT exercised here (no real key in the test world); its pure
//? parsers + cache are pinned in `tests/unit/aiModelListing.test.mts`.

interface ModelsOk { status: 'success'; result: { models: { id: string; label: string }[]; cached: boolean } }
interface ModelsErr { status: 'error'; errorCode: string }
type ModelsResponse = ModelsOk | ModelsErr;
interface ModelsInput { workspaceId: string; connectionId: string; refresh?: boolean }

export const customTests: CustomTestCase[] = [
  {
    name: 'a connectionId outside the workspace answers ai.connectionNotFound (tenant boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aimodels_c1');
      try {
        const res = await ctx.callApi<ModelsInput, ModelsResponse>({ workspaceId, connectionId: '0'.repeat(24) });
        ctx.expect.eq(res.status, 'error', 'an unknown/foreign connection is rejected');
        if (res.status === 'error') ctx.expect.eq(res.errorCode, 'ai.connectionNotFound', 'errorCode is ai.connectionNotFound');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a subscription backend (claude-cli) answers ai.modelsUnsupported',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aimodels_c2');
      try {
        const row = await ctx.prisma.aiConnection.create({ data: { workspaceId, providerId: 'claude-cli', model: '' } });
        const res = await ctx.callApi<ModelsInput, ModelsResponse>({ workspaceId, connectionId: row.id, refresh: true });
        ctx.expect.eq(res.status, 'error', 'no model list for a host-CLI backend');
        if (res.status === 'error') ctx.expect.eq(res.errorCode, 'ai.modelsUnsupported', 'errorCode is ai.modelsUnsupported');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a caller with no membership on the target workspace is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aimodels_c3');
      try {
        const res = await ctx.callApi<ModelsInput, ModelsResponse>({ workspaceId: '0'.repeat(24), connectionId: '0'.repeat(24) });
        ctx.expect.eq(res.status, 'error', 'foreign workspace is rejected');
        if (res.status === 'error') ctx.expect.eq(res.errorCode, 'auth.forbidden', 'errorCode is auth.forbidden');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
