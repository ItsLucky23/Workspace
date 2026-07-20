import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/ticketEdit/v1` — the realtime ticket-edit write
//? (title/description/labels/priority/serviceId). Cases:
//?  [1] happy path — a room member edits a seeded ticket's title; asserted via the
//?      REAL Prisma post-condition (the Conductor's single-writer persistence).
//?  [2] tenant/RBAC boundary — a user who is a room member but NOT a `WorkspaceMember`
//?      of this workspace is rejected with `auth.forbidden`, and the ticket is untouched.

interface TicketEditInput {
  ticketId: string;
  title?: string;
  clientRequestId: string;
}
interface TicketEditOk {
  status: 'success';
  tickets: unknown;
}
interface TicketEditErr {
  status: 'error';
  errorCode: string;
}
type TicketEditResponse = TicketEditOk | TicketEditErr;

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
    name: 'happy path edits the ticket title (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'ticketedit_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId } });
        if (!ticket) throw new Error('seeded workspace has no tickets');
        const newTitle = `Edited by sync harness ${String(Date.now())}`;
        const res = await ctx.callSync<TicketEditInput, TicketEditResponse>(
          { ticketId: ticket.key, title: newTitle, clientRequestId: `te-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'ticketEdit returns status "success"');

        const edited = await poll(() => ctx.prisma.ticket.findFirst({ where: { id: ticket.id, title: newTitle } }));
        ctx.expect.ok(edited !== null, 'the Conductor persisted the title edit (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'ticketedit_c2');
      const outsider = await createRealUser(ctx.prisma, 'ticketedit_c2_outsider');
      try {
        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId } });
        if (!ticket) throw new Error('seeded workspace has no tickets');
        const originalTitle = ticket.title;

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<TicketEditInput, TicketEditResponse>(
          { ticketId: ticket.key, title: 'Should not be applied', clientRequestId: `te-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const untouched = await ctx.prisma.ticket.findFirst({ where: { id: ticket.id } });
        ctx.expect.eq(untouched?.title, originalTitle, 'the ticket title was not changed by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
