import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route business regression: the authenticated initiator receives the fresh credential once,
//? while the shared workspace projection exposes configured metadata only.
interface RotateResponse {
  status: 'success';
  result: { webhookSecret: string };
}

const uniqueEmail = (): string => `lstest_rotate_webhook_${String(Date.now())}_${String(Math.floor(Math.random() * 1e6))}@youcomm.nl`;

async function cleanupRouteWorkspace(ctx: TestContext, workspaceId: string | null, userId: string): Promise<void> {
  if (workspaceId === null) {
    await ctx.prisma.user.delete({ where: { id: userId } });
    return;
  }
  await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
}

export const customTests: CustomTestCase[] = [
  {
    name: 'returns the rotated secret only in the initiator response',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login({ email: uniqueEmail() });
      let workspaceId: string | null = null;
      try {
        const membership = await ctx.prisma.workspaceMember.findFirst({ where: { userId }, select: { workspaceId: true } });
        ctx.expect.ok(membership !== null, 'first login seeded a workspace membership');
        if (!membership) return;
        workspaceId = membership.workspaceId;
        const response = await ctx.callApi<{ workspaceId: string; clientRequestId: string }, RotateResponse>({
          workspaceId,
          clientRequestId: `route-rotate-${String(Date.now())}`,
        });
        ctx.expect.ok(response.result.webhookSecret.length > 20, 'initiator receives a non-empty fresh secret');
        const row = await ctx.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { webhookSecret: true } });
        ctx.expect.eq(row?.webhookSecret, response.result.webhookSecret, 'the Conductor persisted the returned secret');
      } finally {
        await cleanupRouteWorkspace(ctx, workspaceId, userId);
      }
    },
  },
];
