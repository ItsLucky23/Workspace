import { randomBytes } from 'node:crypto';

import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/ticketArtifact/v1` — the ticket↔artifact link/unlink
//? write (ADR 0034). Cases:
//?  [1] happy path — a room member links a design artifact to a seeded ticket; asserted
//?      via the REAL `TicketArtifactLink` Prisma post-condition (Mongo has no FK
//?      constraint, so a synthetic-but-valid ObjectId `artifactId` is enough — the route
//?      itself never dereferences the artifact row).
//?  [2] tenant/RBAC boundary — a user who is a room member but NOT a `WorkspaceMember`
//?      of this workspace is rejected with `auth.forbidden`, and no link is created.
//?  [3] `ticket-unlink-artifact` removes the `TicketArtifactLink` row; asserted via the
//?      real Prisma post-condition on a fixture link (plain Prisma delete, no infra
//?      dependency).

interface TicketArtifactInput {
  op: string;
  clientRequestId: string;
  ticketId?: string;
  artifactId?: string;
  artifactKind?: string;
  linkId?: string;
}
interface TicketArtifactOk {
  status: 'success';
}
interface TicketArtifactErr {
  status: 'error';
  errorCode: string;
}
type TicketArtifactResponse = TicketArtifactOk | TicketArtifactErr;

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

//? A valid-shape (24-hex) Mongo ObjectId string that doesn't need to reference a real row.
const fakeObjectId = (): string => randomBytes(12).toString('hex');

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path links an artifact to a ticket (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'ticketartifact_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId } });
        if (!ticket) throw new Error('seeded workspace has no tickets');
        const artifactId = fakeObjectId();
        const res = await ctx.callSync<TicketArtifactInput, TicketArtifactResponse>(
          { op: 'ticket-link-artifact', ticketId: ticket.key, artifactId, artifactKind: 'design', clientRequestId: `ta-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'ticketArtifact link returns status "success"');

        const link = await poll(() => ctx.prisma.ticketArtifactLink.findFirst({ where: { workspaceId, ticketId: ticket.id, artifactId } }));
        ctx.expect.ok(link !== null, 'the Conductor persisted the ticket-artifact link (post-condition, not just the ack)');
        ctx.expect.eq(link?.artifactKind, 'design', 'the link stores the artifactKind sent by the client');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'ticketartifact_c2');
      const outsider = await createRealUser(ctx.prisma, 'ticketartifact_c2_outsider');
      try {
        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId } });
        if (!ticket) throw new Error('seeded workspace has no tickets');
        const artifactId = fakeObjectId();

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<TicketArtifactInput, TicketArtifactResponse>(
          { op: 'ticket-link-artifact', ticketId: ticket.key, artifactId, artifactKind: 'design', clientRequestId: `ta-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const link = await ctx.prisma.ticketArtifactLink.findFirst({ where: { workspaceId, ticketId: ticket.id, artifactId } });
        ctx.expect.ok(link === null, 'no link was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
  {
    name: 'ticket-unlink-artifact removes the TicketArtifactLink row (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'ticketartifact_c3');
      try {
        await joinRoom(ctx, workspaceId);
        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId } });
        if (!ticket) throw new Error('seeded workspace has no tickets');
        const artifactId = fakeObjectId();
        const fixture = await ctx.prisma.ticketArtifactLink.create({
          data: { workspaceId, ticketId: ticket.id, artifactId, artifactKind: 'design', linkedBy: userId },
        });

        const res = await ctx.callSync<TicketArtifactInput, TicketArtifactResponse>(
          { op: 'ticket-unlink-artifact', linkId: fixture.id, clientRequestId: `ta-c3-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'ticket-unlink-artifact returns status "success"');

        //? `poll()` stops on the first non-null/undefined value, so poll for the row's ABSENCE by
        //? returning a sentinel once it's gone (a `null` Prisma result would otherwise be read as "not ready yet").
        const gone = await poll(async () => {
          const row = await ctx.prisma.ticketArtifactLink.findFirst({ where: { id: fixture.id } });
          return row === null ? ('gone' as const) : null;
        });
        ctx.expect.ok(gone === 'gone', 'the Conductor deleted the TicketArtifactLink row (post-condition, not just the ack)');
      } finally {
        await ctx.prisma.ticketArtifactLink.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
