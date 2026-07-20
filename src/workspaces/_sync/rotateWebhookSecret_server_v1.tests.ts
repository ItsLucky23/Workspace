import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/rotateWebhookSecret/v1` — the realtime `#27`
//? inbound-webhook secret rotation (`dispatchControlSync` op `forge-webhook-rotate`,
//? `CAP.workspaceSettings`). The auto-sweep does not walk `_sync` routes, so these
//? cases stand in for contract/auth coverage too:
//?  [1] happy path — an Owner rotates the secret; asserted via the REAL Prisma
//?      post-condition (`Workspace.webhookSecret` actually changed), not just the ack.
//?      The plaintext itself is intentionally NOT broadcast (see the route's doc-comment)
//?      — the ack only confirms `webhookConfigured: true`.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and the secret is left untouched.

interface RotateWebhookInput {
  clientRequestId: string;
}
interface RotateWebhookOk {
  status: 'success';
  webhookConfigured: boolean;
}
interface RotateWebhookErr {
  status: 'error';
  errorCode: string;
}
type RotateWebhookResponse = RotateWebhookOk | RotateWebhookErr;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T | null>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path rotates the webhook secret (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'rotatewh_c1');
      try {
        const before = await ctx.prisma.workspace.findUnique({ where: { id: workspaceId } });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<RotateWebhookInput, RotateWebhookResponse>(
          { clientRequestId: `rw-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        //? Note: the HTTP sync transport wraps the route's own `{ status, webhookConfigured }`
        //? return inside a `{ status: 'success', result: <routeOutput> }` envelope, so
        //? `res.status` here only proves the transport call didn't error — the real
        //? post-condition is the Prisma poll below (same convention as the quickAdd exemplar).
        ctx.expect.eq(res.status, 'success', 'rotateWebhookSecret returns status "success"');

        const after = await poll(async () => {
          const ws = await ctx.prisma.workspace.findUnique({ where: { id: workspaceId } });
          if (ws && ws.webhookSecret && ws.webhookSecret !== (before?.webhookSecret ?? null)) return ws;
          return null;
        });
        ctx.expect.ok(after !== null, 'the Conductor rotated the secret to a new, non-empty value');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'rotatewh_c2');
      const outsider = await createRealUser(ctx.prisma, 'rotatewh_c2_outsider');
      try {
        const before = await ctx.prisma.workspace.findUnique({ where: { id: workspaceId } });
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<RotateWebhookInput, RotateWebhookResponse>(
          { clientRequestId: `rw-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const after = await ctx.prisma.workspace.findUnique({ where: { id: workspaceId } });
        ctx.expect.eq(
          after?.webhookSecret ?? null,
          before?.webhookSecret ?? null,
          'the webhook secret was not rotated by the rejected call',
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
