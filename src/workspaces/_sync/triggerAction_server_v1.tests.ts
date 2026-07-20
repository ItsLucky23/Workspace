import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/triggerAction/v1` — the automation-trigger control-op
//? (trigger-save/trigger-toggle/trigger-delete/trigger-run/run-agent-role), dispatched
//? through the single-writer Conductor (RBAC-gated: editPipeline). The auto-sweep does
//? not walk `_sync` routes, so these cases also stand in for basic contract/auth coverage:
//?  [1] happy path — `trigger-save` creates a `WorkspaceTrigger` row; asserted via the
//?      REAL Prisma post-condition (the Conductor's single-writer persistence, B-23),
//?      not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and no trigger is created.

interface TriggerActionInput {
  op: string;
  clientRequestId: string;
  name?: string;
  on?: string;
  action?: string;
}
interface TriggerActionOk {
  status: 'success';
}
interface TriggerActionErr {
  status: 'error';
  errorCode: string;
}
type TriggerActionResponse = TriggerActionOk | TriggerActionErr;

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
    name: 'happy path: trigger-save creates a WorkspaceTrigger (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'triggeraction_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const name = `Sync harness trigger ${String(Date.now())}`;
        const res = await ctx.callSync<TriggerActionInput, TriggerActionResponse>(
          { op: 'trigger-save', name, on: 'ticket.created', action: 'notify', clientRequestId: `ta-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'triggerAction returns status "success"');

        const trigger = await poll(() => ctx.prisma.workspaceTrigger.findFirst({ where: { workspaceId, name } }));
        ctx.expect.ok(trigger !== null, 'the Conductor persisted the WorkspaceTrigger (post-condition, not just the ack)');
        ctx.expect.eq(trigger?.on, 'ticket.created', 'the trigger stored the requested `on` field');
        ctx.expect.eq(trigger?.action, 'notify', 'the trigger stored the requested `action` field');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'triggeraction_c2');
      const outsider = await createRealUser(ctx.prisma, 'triggeraction_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const name = `Should not be created ${String(Date.now())}`;
        const res = await ctx.callSync<TriggerActionInput, TriggerActionResponse>(
          { op: 'trigger-save', name, on: 'ticket.created', action: 'notify', clientRequestId: `ta-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const trigger = await ctx.prisma.workspaceTrigger.findFirst({ where: { workspaceId, name } });
        ctx.expect.ok(trigger === null, 'no trigger was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
