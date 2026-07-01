import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import { tryCatch } from '@luckystack/core';

//? Per-route tests for `workspaces/control/v1` — the single [control-API] write
//? dispatcher. The auto-sweep covers contract/auth/rate-limit/fuzz; these cases
//? assert the op-dispatch business logic the sweep can't reach:
//?   - create-workspace happy path bootstraps a tenant + returns its id
//?   - an unknown op is rejected before any write
//?   - a nameless create-workspace is rejected
//?
//? Integration cases create real rows (a throwaway user + one workspace), so each
//? case cleans up after itself (workspace children → workspace → user).

//? Transport envelope (CONTROL_API §6.1). `op` is a plain string here so the
//? unknown-op case can send a value outside the `ControlOp` union.
interface ControlInput {
  workspaceId?: string;
  op: string;
  target: Record<string, unknown>;
  payload: Record<string, unknown>;
  clientRequestId: string;
}

type ControlResult =
  | { status: 'success'; result: { accepted: boolean; signalSeq: number; workspaceId?: string } }
  | { status: 'error'; errorCode: string };

async function deleteWorkspace(ctx: TestContext, workspaceId: string): Promise<void> {
  await ctx.prisma.workspaceMember.deleteMany({ where: { workspaceId } });
  await ctx.prisma.workspaceRole.deleteMany({ where: { workspaceId } });
  await ctx.prisma.workspace.delete({ where: { id: workspaceId } });
}

async function deleteUser(ctx: TestContext, userId: string): Promise<void> {
  //? Best-effort teardown of the throwaway login user; ignore if already gone.
  await tryCatch(() => ctx.prisma.user.delete({ where: { id: userId } }));
}

export const customTests: CustomTestCase[] = [
  {
    name: 'create-workspace happy path returns success + a new workspaceId',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login();
      const res = await ctx.callApi<ControlInput, ControlResult>({
        op: 'create-workspace',
        target: {},
        payload: { name: 'WF Test WS' },
        clientRequestId: 't1',
      });

      ctx.expect.eq(res.status, 'success', 'create-workspace should succeed');
      let newId: string | undefined;
      if (res.status === 'success') {
        newId = res.result.workspaceId;
        ctx.expect.ok(newId, 'the ack carries the newly created workspaceId');
      }

      if (newId) await deleteWorkspace(ctx, newId);
      await deleteUser(ctx, userId);
    },
  },
  {
    name: 'unknown op is rejected with an error status',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login();
      const res = await ctx.callApi<ControlInput, ControlResult>({
        op: 'bogus',
        target: {},
        payload: {},
        clientRequestId: 't2',
      });

      ctx.expect.eq(res.status, 'error', 'an op outside the union must be rejected');
      await deleteUser(ctx, userId);
    },
  },
  {
    name: 'create-workspace without a name is rejected',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login();
      const res = await ctx.callApi<ControlInput, ControlResult>({
        op: 'create-workspace',
        target: {},
        payload: {},
        clientRequestId: 't3',
      });

      ctx.expect.eq(res.status, 'error', 'a nameless create-workspace must be rejected');
      await deleteUser(ctx, userId);
    },
  },
];
