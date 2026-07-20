import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveIntegration/v1` — the realtime write that creates
//? (or, with `integrationId`, updates) an `IntegrationTool` row. The auto-sweep does not walk
//? `_sync` routes, so these cases stand in for basic contract/auth coverage too:
//?  [1] happy path — a workspaceSettings-capable member creates a new integration; asserted
//?      via the REAL Prisma post-condition on `IntegrationTool` (the Conductor's single-writer
//?      persistence), not just the ack.
//?  [2] validation boundary — per `saveIntegrationRequest` (source), a blank `name` is
//?      rejected BEFORE dispatch with `sync.invalidRequest`, and no row is created. Chosen over
//?      the generic outsider case because this route's own business-logic validation is the
//?      more interesting, route-specific boundary to prove.

interface SaveIntegrationInput {
  integrationId?: string;
  name: string;
  type: string;
  fields: { id: string; label: string; placeholder?: string; envVarId: string | null }[];
  mcp: { enabled: boolean; command: string };
  clientRequestId: string;
}
//? The HTTP sync harness wraps a route's own `SyncServerResponse` inside an outer
//? `{ status: 'success', message, result: <route output> }` envelope on success (see
//? `@luckystack/sync`'s http-sync handler); a validation/RBAC rejection short-circuits to a
//? FLAT `{ status: 'error', errorCode }` before that wrap ever happens. So a success case
//? reads the route's own fields off `res.result`, never off `res` directly.
interface SaveIntegrationOk {
  status: 'success';
  message: string;
  result: { status: 'success'; integration: { id: string; name: string } | null };
}
interface SaveIntegrationErr {
  status: 'error';
  errorCode: string;
}
type SaveIntegrationResponse = SaveIntegrationOk | SaveIntegrationErr;

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
    name: 'happy path creates a new integration (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveintegration_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const name = `Sync harness integration ${String(Date.now())}`;
        const res = await ctx.callSync<SaveIntegrationInput, SaveIntegrationResponse>(
          { name, type: 'custom', fields: [], mcp: { enabled: false, command: '' }, clientRequestId: `si-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'saveIntegration returns status "success"');

        const integration = await poll(() => ctx.prisma.integrationTool.findFirst({ where: { workspaceId, name } }));
        ctx.expect.ok(integration !== null, 'the Conductor persisted the integration (post-condition, not just the ack)');
        ctx.expect.eq(integration?.type, 'custom', 'persisted type matches');
        if (res.status === 'success') {
          ctx.expect.eq(res.result.integration?.id, integration?.id, 'the ack echoes the persisted row id');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a blank name is rejected with sync.invalidRequest (validation boundary) and no row is created',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveintegration_c2');
      try {
        await joinRoom(ctx, workspaceId);
        //? The seeded demo workspace ships with its own pre-existing integration rows, so the
        //? "no row created" assertion below is a before/after COUNT DELTA, not an absolute 0.
        const before = await ctx.prisma.integrationTool.count({ where: { workspaceId } });
        const res = await ctx.callSync<SaveIntegrationInput, SaveIntegrationResponse>(
          { name: '   ', type: 'custom', fields: [], mcp: { enabled: false, command: '' }, clientRequestId: `si-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a blank name is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'sync.invalidRequest', 'rejected with sync.invalidRequest, the route\'s own pre-dispatch validation');
        }

        const after = await ctx.prisma.integrationTool.count({ where: { workspaceId } });
        ctx.expect.eq(after, before, 'no integration row was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
