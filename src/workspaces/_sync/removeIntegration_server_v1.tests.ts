import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/removeIntegration/v1` — the realtime write that deletes
//? an `IntegrationTool` row. The auto-sweep does not walk `_sync` routes, so these cases stand
//? in for basic contract/auth coverage too:
//?  [1] happy path — a workspaceSettings-capable member deletes a pre-seeded integration;
//?      asserted via the REAL Prisma post-condition (the row is gone), not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` is rejected
//?      with `auth.forbidden`, and the row is left untouched.

interface RemoveIntegrationInput {
  integrationId: string;
  clientRequestId: string;
}
//? The HTTP sync harness wraps a route's own `SyncServerResponse` inside an outer
//? `{ status: 'success', message, result: <route output> }` envelope on success (see
//? `@luckystack/sync`'s http-sync handler); an RBAC rejection short-circuits to a FLAT
//? `{ status: 'error', errorCode }` before that wrap ever happens. So a success case reads
//? the route's own fields off `res.result`, never off `res` directly.
interface RemoveIntegrationOk {
  status: 'success';
  message: string;
  result: { status: 'success'; removedIntegrationId: string };
}
interface RemoveIntegrationErr {
  status: 'error';
  errorCode: string;
}
type RemoveIntegrationResponse = RemoveIntegrationOk | RemoveIntegrationErr;

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
    name: 'happy path deletes the integration (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'removeintegration_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const seeded = await ctx.prisma.integrationTool.create({
          data: { workspaceId, name: `To remove ${String(Date.now())}`, type: 'custom', fields: [], mcp: { enabled: false, command: '' } },
        });
        const res = await ctx.callSync<RemoveIntegrationInput, RemoveIntegrationResponse>(
          { integrationId: seeded.id, clientRequestId: `ri-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'removeIntegration returns status "success"');
        if (res.status === 'success') {
          ctx.expect.eq(res.result.removedIntegrationId, seeded.id, 'the ack echoes the removed integration id');
        }

        const gone = await poll(async () => {
          const found = await ctx.prisma.integrationTool.findFirst({ where: { id: seeded.id } });
          return found === null ? true : null;
        });
        ctx.expect.ok(gone === true, 'the Conductor deleted the row (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'removeintegration_c2');
      const outsider = await createRealUser(ctx.prisma, 'removeintegration_c2_outsider');
      try {
        const seeded = await ctx.prisma.integrationTool.create({
          data: { workspaceId, name: `Should survive ${String(Date.now())}`, type: 'custom', fields: [], mcp: { enabled: false, command: '' } },
        });
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<RemoveIntegrationInput, RemoveIntegrationResponse>(
          { integrationId: seeded.id, clientRequestId: `ri-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const stillThere = await ctx.prisma.integrationTool.findFirst({ where: { id: seeded.id } });
        ctx.expect.ok(stillThere !== null, 'the integration row was left untouched by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
