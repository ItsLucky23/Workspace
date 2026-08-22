import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/unarchive/v1` (F-015) — the realtime restore of archived
//? ticket(s) (`archived: false`), the inverse of archive/bulk-archive. Cases:
//?  [1] happy path — 2 freshly-seeded ARCHIVED tickets are restored in one call; asserted via the
//?      REAL Prisma post-condition that BOTH rows flipped back (not just the ack).
//?  [2] tenant/RBAC boundary — a user who is a room member but NOT a `WorkspaceMember`
//?      of this workspace is rejected with `auth.forbidden`, and both tickets stay archived.

interface UnarchiveInput {
  ticketIds: string[];
  clientRequestId: string;
}
interface UnarchiveOk {
  status: 'success';
  tickets: unknown;
}
interface UnarchiveErr {
  status: 'error';
  errorCode: string;
}
type UnarchiveResponse = UnarchiveOk | UnarchiveErr;

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

async function seedTwoTickets(ctx: TestContext, workspaceId: string, tag: string): Promise<{ id: string; key: string }[]> {
  const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
  if (!project) throw new Error('seeded workspace has no project');
  const ts = Date.now();
  const tickets = [];
  for (let i = 0; i < 2; i += 1) {
    const key = `UNA-${tag}-${String(ts)}-${String(i)}`;
    const row = await ctx.prisma.ticket.create({
      data: { workspaceId, projectId: project.id, key, number: ts + i, title: `Unarchive test ticket ${String(i)}`, stageId: 'unrefined', status: 'idle', labels: [], archived: true },
    });
    tickets.push({ id: row.id, key: row.key });
  }
  return tickets;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path restores both archived tickets (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'unarchive_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const tickets = await seedTwoTickets(ctx, workspaceId, 'c1');
        const res = await ctx.callSync<UnarchiveInput, UnarchiveResponse>(
          { ticketIds: tickets.map((t) => t.key), clientRequestId: `una-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'unarchive returns status "success"');

        const restoredCount = await poll(async () => {
          const count = await ctx.prisma.ticket.count({ where: { id: { in: tickets.map((t) => t.id) }, archived: false } });
          return count === 2 ? count : null;
        });
        ctx.expect.eq(restoredCount, 2, 'the Conductor restored BOTH tickets (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'unarchive_c2');
      const outsider = await createRealUser(ctx.prisma, 'unarchive_c2_outsider');
      try {
        const tickets = await seedTwoTickets(ctx, workspaceId, 'c2');

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<UnarchiveInput, UnarchiveResponse>(
          { ticketIds: tickets.map((t) => t.key), clientRequestId: `una-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const archivedCount = await ctx.prisma.ticket.count({ where: { id: { in: tickets.map((t) => t.id) }, archived: true } });
        ctx.expect.eq(archivedCount, 2, 'both tickets stay archived for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
