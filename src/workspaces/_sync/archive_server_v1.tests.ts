import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/archive/v1` — the realtime single-ticket archive
//? write (`archived: true`, soft — never deletes). Cases:
//?  [1] happy path — a room member archives a seeded ticket; asserted via the REAL
//?      Prisma post-condition (the Conductor's single-writer persistence).
//?  [2] tenant/RBAC boundary — a user who is a room member but NOT a `WorkspaceMember`
//?      of this workspace is rejected with `auth.forbidden`, and the ticket stays unarchived.

interface ArchiveInput {
  ticketId: string;
  clientRequestId: string;
}
interface ArchiveOk {
  status: 'success';
  tickets: unknown;
}
interface ArchiveErr {
  status: 'error';
  errorCode: string;
}
type ArchiveResponse = ArchiveOk | ArchiveErr;

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
    name: 'happy path archives the ticket (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'archive_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId, archived: false } });
        if (!ticket) throw new Error('seeded workspace has no unarchived tickets');
        const res = await ctx.callSync<ArchiveInput, ArchiveResponse>(
          { ticketId: ticket.key, clientRequestId: `ar-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'archive returns status "success"');

        const archived = await poll(() => ctx.prisma.ticket.findFirst({ where: { id: ticket.id, archived: true } }));
        ctx.expect.ok(archived !== null, 'the Conductor persisted the archive (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'archive_c2');
      const outsider = await createRealUser(ctx.prisma, 'archive_c2_outsider');
      try {
        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId, archived: false } });
        if (!ticket) throw new Error('seeded workspace has no unarchived tickets');

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ArchiveInput, ArchiveResponse>(
          { ticketId: ticket.key, clientRequestId: `ar-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const untouched = await ctx.prisma.ticket.findFirst({ where: { id: ticket.id } });
        ctx.expect.eq(untouched?.archived, false, 'the ticket was not archived by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
