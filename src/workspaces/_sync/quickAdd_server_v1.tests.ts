import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/quickAdd/v1` — the realtime quick-add write. The
//? auto-sweep does not walk `_sync` routes (only Layer 5 / this file does), so these
//? cases also stand in for basic contract/auth coverage on top of the business logic:
//?  [1] happy path — a room member creates a ticket; asserted via the REAL Prisma
//?      post-condition (the Conductor's single-writer persistence), not just the ack.
//?  [2] tenant/RBAC boundary — a user who is a room member but NOT a `WorkspaceMember`
//?      of this workspace is rejected with `auth.forbidden`, and no ticket is created.
//?
//? `main()` in `quickAdd_server_v1.ts` AWAITS `enqueueControlAction` before returning, so
//? the ack already reflects the Conductor's outcome for THIS route — but per the
//? standing single-writer invariant (B-23) the ack is never treated as the post-condition
//? here; we poll the real row the same way the standalone Conductor suites do
//? (`tests/integration/quickAddSprint.test.mts`), so the case stays correct even for a
//? route whose ack legitimately precedes a background follow-up.

interface QuickAddInput {
  title: string;
  clientRequestId: string;
}
interface QuickAddOk {
  status: 'success';
  ticket: { id: string; title: string } | null;
}
interface QuickAddErr {
  status: 'error';
  errorCode: string;
}
type QuickAddResponse = QuickAddOk | QuickAddErr;

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

//? Room membership for HTTP-fired sync calls comes from the shared `joinRoom` helper
//? (tests/_helpers.mts) — see its doc-comment for why this is required and principled.

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path creates a ticket (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'quickadd_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const title = `Sync harness ticket ${String(Date.now())}`;
        const res = await ctx.callSync<QuickAddInput, QuickAddResponse>(
          { title, clientRequestId: `qa-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'quickAdd returns status "success"');

        const ticket = await poll(() => ctx.prisma.ticket.findFirst({ where: { workspaceId, title } }));
        ctx.expect.ok(ticket !== null, 'the Conductor persisted the ticket (post-condition, not just the ack)');
        ctx.expect.eq(ticket?.stageId, 'unrefined', 'a fresh quick-add ticket lands at the unrefined stage');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'quickadd_c2');
      const outsider = await createRealUser(ctx.prisma, 'quickadd_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const title = `Should not be created ${String(Date.now())}`;
        const res = await ctx.callSync<QuickAddInput, QuickAddResponse>(
          { title, clientRequestId: `qa-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId, title } });
        ctx.expect.ok(ticket === null, 'no ticket was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
