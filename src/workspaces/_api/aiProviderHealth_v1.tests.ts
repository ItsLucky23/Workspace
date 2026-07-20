import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/aiProviderHealth/v1`. The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't
//? reach:
//?  [1] a member with `workTickets` gets back the full provider registry (both known
//?      backends, each with an `available` boolean) — the read `availableProviders()` was
//?      "exported for a UI that never came" until this route.
//?  [2] a caller with no membership on the target workspace is rejected with
//?      `auth.forbidden` (the `hasCapability` tenant boundary).
//?
//? Integration test: `loginSeededUser` creates a real `User` + seeds a demo workspace
//? (owner role, full perms), logs in as the owner. Teardown via `cleanupWorkspace`.

interface ProviderHealthOk {
  status: 'success';
  result: { providers: { id: string; label: string; available: boolean }[] };
}
interface ProviderHealthErr {
  status: 'error';
  errorCode: string;
}
type ProviderHealthResponse = ProviderHealthOk | ProviderHealthErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a member with workTickets gets the full provider registry',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aiprovhealth_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string }, ProviderHealthResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'aiProviderHealth returns status "success" for a member');
        if (res.status !== 'success') return;
        ctx.expect.ok(Array.isArray(res.result.providers) && res.result.providers.length > 0, 'result.providers is a non-empty array');
        const ids = new Set(res.result.providers.map((p) => p.id));
        ctx.expect.ok(ids.has('claude-cli') && ids.has('gemini-api'), 'result.providers includes both known backends');
        ctx.expect.ok(
          res.result.providers.every((p) => typeof p.available === 'boolean'),
          'every provider entry carries a boolean "available" field',
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a caller with no membership on the target workspace is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aiprovhealth_c2');
      try {
        const foreignWorkspaceId = '0'.repeat(24);
        const res = await ctx.callApi<{ workspaceId: string }, ProviderHealthResponse>({ workspaceId: foreignWorkspaceId });
        ctx.expect.eq(res.status, 'error', 'aiProviderHealth rejects a caller with no membership');
        if (res.status !== 'error') return;
        ctx.expect.eq(res.errorCode, 'auth.forbidden', 'errorCode is auth.forbidden');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
