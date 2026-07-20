import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser, loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/containerTerminals/v1` — enumerates the workspace's
//? running ticket containers for the Terminals page. Read-only, membership-gated (no
//? capability beyond plain membership). The auto-sweep already covers contract/auth/
//? rate-limit/fuzz; these cases assert:
//?  [1] a plain member gets a success envelope with `result.containers` as an array
//?      (`listWorkspaceContainers` degrades to `[]` when Docker is unavailable — the
//?      page's documented empty-state — so this is deterministic in any environment).
//?  [2] a user with no membership on the workspace is refused with `auth.forbidden`.
//?
//? Integration test: `loginSeededUser` creates a real `User` + logs in + seeds a demo
//? workspace. Teardown via the shared `cleanupWorkspace` harness helper.

interface ContainerTerminalsOk { status: 'success'; result: { containers: { ticketKey: string; container: string }[] } }
interface ContainerTerminalsErr { status: 'error'; errorCode: string }
type ContainerTerminalsResponse = ContainerTerminalsOk | ContainerTerminalsErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a workspace member gets a success envelope with an array of containers',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'containerTerminals_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string }, ContainerTerminalsResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'containerTerminals returns status "success"');
        ctx.expect.ok(res.status === 'success' && Array.isArray(res.result.containers), 'result.containers is an array (empty when Docker is unavailable)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'missing workspaceId returns api.invalidRequest',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'containerTerminals_c2');
      try {
        const res = await ctx.callApi<{ workspaceId: string }, ContainerTerminalsResponse>({ workspaceId: '' });
        ctx.expect.eq(res.status, 'error', 'an empty workspaceId is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'api.invalidRequest', 'errorCode is api.invalidRequest');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a user with no membership on the workspace is refused with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'containerTerminals_c3_owner');
      const outsider = await createRealUser(ctx.prisma, 'containerTerminals_c3_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string }, ContainerTerminalsResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'error', 'a non-member is refused');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', 'errorCode is auth.forbidden');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [ownerId, outsider.id]);
      }
    },
  },
];
