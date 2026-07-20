import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/rotateWebhookSecret/v1` — mints a fresh inbound-webhook
//? secret for a workspace via the Conductor (single-writer, B-23). Auto-sweep covers
//? contract/auth/rate-limit/fuzz; these cases assert:
//?  [1] a member with `workspaceSettings` capability rotates the secret and it is persisted.
//?  [2] a user with no membership in the target workspace is rejected `auth.forbidden`
//?      (the RBAC boundary — `dispatchControlSync` checks capability before enqueueing).
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId — the
//? harness's synthetic id fallback breaks `user.id`-scoped Prisma queries) and seeds a demo
//? workspace (first-login auto-seed was removed in commit 42632a2, so login alone no longer
//? populates one) so the caller has the `owner` role's `workspaceSettings` capability.
//? Teardown via the shared `cleanupWorkspace` harness helper for each seeded workspace.

type RotateResponse =
  | { status: 'success'; result: { webhookSecret: string } }
  | { status: 'error'; errorCode: string };

export const customTests: CustomTestCase[] = [
  {
    name: 'a workspace member rotates the secret and it is persisted',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'rotatewh_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string; clientRequestId: string }, RotateResponse>({
          workspaceId, clientRequestId: `rotatewh-c1-${String(Date.now())}`,
        });
        ctx.expect.eq(res.status, 'success', 'rotateWebhookSecret returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.ok(res.result.webhookSecret.length > 20, 'a non-trivial secret is returned');
        const row = await ctx.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { webhookSecret: true } });
        ctx.expect.eq(row?.webhookSecret, res.result.webhookSecret, 'the Conductor persisted the returned secret');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a non-member of the target workspace is rejected',
    run: async (ctx: TestContext) => {
      const target = await loginSeededUser(ctx, 'rotatewh_c2_target');
      const outsider = await loginSeededUser(ctx, 'rotatewh_c2_outsider');
      try {
        // loginSeededUser logs in as the LAST user it created — the outsider — so this call
        // is made as a user who is not a member of `target.workspaceId`.
        const res = await ctx.callApi<{ workspaceId: string; clientRequestId: string }, RotateResponse>({
          workspaceId: target.workspaceId, clientRequestId: `rotatewh-c2-${String(Date.now())}`,
        });
        ctx.expect.eq(res.status, 'error', 'a non-member is rejected');
        if (res.status === 'error') ctx.expect.eq(res.errorCode, 'auth.forbidden', 'errorCode is auth.forbidden');
        const row = await ctx.prisma.workspace.findUnique({ where: { id: target.workspaceId }, select: { webhookSecret: true } });
        ctx.expect.eq(row?.webhookSecret, null, "the target workspace's secret is unchanged (still unset)");
      } finally {
        await cleanupWorkspace(ctx.prisma, target.workspaceId, [target.userId]);
        await cleanupWorkspace(ctx.prisma, outsider.workspaceId, [outsider.userId]);
      }
    },
  },
];
