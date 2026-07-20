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
//?  [3] `trigger-toggle` flips `WorkspaceTrigger.enabled`; asserted via the real Prisma
//?      post-condition on a fixture trigger.
//?  [4] `trigger-delete` removes the `WorkspaceTrigger` row; asserted via the real Prisma
//?      post-condition on a fixture trigger.
//?  [5] `trigger-run` executes a `notify`-action trigger NOW (ungated: `requiresApproval:
//?      false`) — asserted via the real `Notification` row it fans out to the caller
//?      (DB/local effect only; no forced external call, per `runTriggerActionBody`'s
//?      `notify` branch).

interface TriggerActionInput {
  op: string;
  clientRequestId: string;
  name?: string;
  on?: string;
  action?: string;
  triggerId?: string;
  enabled?: boolean;
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
  {
    name: 'trigger-toggle flips WorkspaceTrigger.enabled (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'triggeraction_c3');
      try {
        await joinRoom(ctx, workspaceId);
        const fixture = await ctx.prisma.workspaceTrigger.create({
          data: { workspaceId, name: `Toggle fixture ${String(Date.now())}`, on: 'ticket.created', match: {}, action: 'notify', params: {}, enabled: true },
        });

        const res = await ctx.callSync<TriggerActionInput, TriggerActionResponse>(
          { op: 'trigger-toggle', triggerId: fixture.id, enabled: false, clientRequestId: `ta-c3-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'trigger-toggle returns status "success"');

        const flipped = await poll(async () => {
          const row = await ctx.prisma.workspaceTrigger.findFirst({ where: { id: fixture.id } });
          return row?.enabled === false ? row : null;
        });
        ctx.expect.ok(flipped !== null, 'the Conductor flipped WorkspaceTrigger.enabled to false (post-condition, not just the ack)');
      } finally {
        await ctx.prisma.workspaceTrigger.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'trigger-delete removes the WorkspaceTrigger row (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'triggeraction_c4');
      try {
        await joinRoom(ctx, workspaceId);
        const fixture = await ctx.prisma.workspaceTrigger.create({
          data: { workspaceId, name: `Delete fixture ${String(Date.now())}`, on: 'ticket.created', match: {}, action: 'notify', params: {}, enabled: true },
        });

        const res = await ctx.callSync<TriggerActionInput, TriggerActionResponse>(
          { op: 'trigger-delete', triggerId: fixture.id, clientRequestId: `ta-c4-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'trigger-delete returns status "success"');

        //? `poll()` stops on the first non-null/undefined value, so poll for the row's ABSENCE by
        //? returning a sentinel once it's gone (a `null` Prisma result would otherwise be read as "not ready yet").
        const gone = await poll(async () => {
          const row = await ctx.prisma.workspaceTrigger.findFirst({ where: { id: fixture.id } });
          return row === null ? ('gone' as const) : null;
        });
        ctx.expect.ok(gone === 'gone', 'the Conductor deleted the WorkspaceTrigger row (post-condition, not just the ack)');
      } finally {
        await ctx.prisma.workspaceTrigger.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'trigger-run executes an ungated notify trigger now (real Notification row, not just the ack)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'triggeraction_c5');
      try {
        await joinRoom(ctx, workspaceId);
        const triggerName = `Run-now fixture ${String(Date.now())}`;
        const fixture = await ctx.prisma.workspaceTrigger.create({
          data: {
            workspaceId, name: triggerName, on: 'ticket.created', match: {}, action: 'notify',
            params: { title: triggerName, body: 'triggered by the sync test harness' }, enabled: true, requiresApproval: false,
          },
        });

        const res = await ctx.callSync<TriggerActionInput, TriggerActionResponse>(
          { op: 'trigger-run', triggerId: fixture.id, clientRequestId: `ta-c5-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'trigger-run returns status "success"');

        const notification = await poll(() => ctx.prisma.notification.findFirst({ where: { workspaceId, userId, type: 'automation', title: triggerName } }));
        ctx.expect.ok(notification !== null, 'trigger-run executed the notify action, fanning out a real Notification row (post-condition, not just the ack)');
      } finally {
        await ctx.prisma.notification.deleteMany({ where: { workspaceId } });
        await ctx.prisma.workspaceTrigger.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
