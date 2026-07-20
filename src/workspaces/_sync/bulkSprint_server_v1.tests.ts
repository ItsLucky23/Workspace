import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/bulkSprint/v1` — the realtime multi-ticket
//? sprint-move write (requires the `manageSprints` capability, OP_CAPABILITY). Cases:
//?  [1] happy path — 2 freshly-seeded tickets (no sprint) are moved to a freshly-seeded
//?      sprint in one call; asserted via the REAL Prisma post-condition that BOTH rows
//?      changed.
//?  [2] tenant/RBAC boundary — a user who is a room member but NOT a `WorkspaceMember`
//?      of this workspace is rejected with `auth.forbidden`, and neither ticket's
//?      sprint changes.

interface BulkSprintInput {
  ticketIds: string[];
  sprintId: string;
  clientRequestId: string;
}
interface BulkSprintOk {
  status: 'success';
  tickets: unknown;
}
interface BulkSprintErr {
  status: 'error';
  errorCode: string;
}
type BulkSprintResponse = BulkSprintOk | BulkSprintErr;

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

async function seedTwoTicketsAndSprint(ctx: TestContext, workspaceId: string, tag: string): Promise<{ sprintId: string; tickets: { id: string; key: string }[] }> {
  const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
  if (!project) throw new Error('seeded workspace has no project');
  const sprint = await ctx.prisma.sprint.create({ data: { workspaceId, projectId: project.id, name: `Bulk test sprint ${tag}`, active: true } });
  const ts = Date.now();
  const tickets = [];
  for (let i = 0; i < 2; i += 1) {
    const key = `BLK-${tag}-${String(ts)}-${String(i)}`;
    const row = await ctx.prisma.ticket.create({
      data: { workspaceId, projectId: project.id, key, number: ts + i, title: `Bulk test ticket ${String(i)}`, stageId: 'unrefined', status: 'idle', labels: [] },
    });
    tickets.push({ id: row.id, key: row.key });
  }
  return { sprintId: sprint.id, tickets };
}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path moves both tickets into the sprint (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'bulksprint_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const { sprintId, tickets } = await seedTwoTicketsAndSprint(ctx, workspaceId, 'c1');
        const res = await ctx.callSync<BulkSprintInput, BulkSprintResponse>(
          { ticketIds: tickets.map((t) => t.key), sprintId, clientRequestId: `bsp-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'bulkSprint returns status "success"');

        const movedCount = await poll(async () => {
          const count = await ctx.prisma.ticket.count({ where: { id: { in: tickets.map((t) => t.id) }, sprintId } });
          return count === 2 ? count : null;
        });
        ctx.expect.eq(movedCount, 2, 'the Conductor moved BOTH tickets into the sprint (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'bulksprint_c2');
      const outsider = await createRealUser(ctx.prisma, 'bulksprint_c2_outsider');
      try {
        const { sprintId, tickets } = await seedTwoTicketsAndSprint(ctx, workspaceId, 'c2');

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<BulkSprintInput, BulkSprintResponse>(
          { ticketIds: tickets.map((t) => t.key), sprintId, clientRequestId: `bsp-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const movedCount = await ctx.prisma.ticket.count({ where: { id: { in: tickets.map((t) => t.id) }, sprintId } });
        ctx.expect.eq(movedCount, 0, 'no ticket was moved into the sprint for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
