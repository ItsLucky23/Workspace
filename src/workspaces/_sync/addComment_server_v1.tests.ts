import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/addComment/v1` — the realtime add-comment write.
//? Appends a `WorkspaceNote` to a ticket, then broadcasts it. The Conductor's
//? `add-comment` case (`conductor.ts`) treats `target.ticketId` as the DEV-#### ticket
//? KEY (looked up via `ticketIdsForKeys`), not a Mongo ObjectId — so this route's
//? `ticketId` client field is confusingly named but is really a ticket KEY. The
//? auto-sweep does not walk `_sync` routes, so these cases also stand in for basic
//? contract/auth coverage on top of the business logic:
//?  [1] happy path — a room member comments on a real (seeded-demo) ticket; asserted
//?      via the REAL Prisma post-condition (the Conductor's single-writer persistence,
//?      B-23), not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and no note is created.

interface AddCommentInput {
  ticketId: string;
  body: string;
  clientRequestId: string;
}
interface AddCommentOk {
  status: 'success';
  note: unknown;
}
interface AddCommentErr {
  status: 'error';
  errorCode: string;
}
type AddCommentResponse = AddCommentOk | AddCommentErr;

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
    name: 'happy path: commenting on a real ticket creates a WorkspaceNote (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'addcomment_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const seededTicket = await ctx.prisma.ticket.findFirst({ where: { workspaceId } });
        ctx.expect.ok(seededTicket !== null, 'the demo seed provided at least one ticket to comment on');
        const ticketKey = seededTicket?.key ?? '';
        const ticketObjectId = seededTicket?.id ?? '';
        const body = `Sync harness comment ${String(Date.now())}`;

        const res = await ctx.callSync<AddCommentInput, AddCommentResponse>(
          { ticketId: ticketKey, body, clientRequestId: `ac-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'addComment returns status "success"');

        const note = await poll(() => ctx.prisma.workspaceNote.findFirst({ where: { workspaceId, ticketId: ticketObjectId, body } }));
        ctx.expect.ok(note !== null, 'the Conductor persisted the note (post-condition, not just the ack)');
        ctx.expect.eq(note?.authorId, userId, 'the note is attributed to the commenting user');
        ctx.expect.eq(note?.authorKind, 'user', 'the note is authored by a user, not the AI');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'addcomment_c2');
      const outsider = await createRealUser(ctx.prisma, 'addcomment_c2_outsider');
      try {
        const seededTicket = await ctx.prisma.ticket.findFirst({ where: { workspaceId } });
        const ticketKey = seededTicket?.key ?? '';

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const body = `Should not be created ${String(Date.now())}`;
        const res = await ctx.callSync<AddCommentInput, AddCommentResponse>(
          { ticketId: ticketKey, body, clientRequestId: `ac-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const note = await ctx.prisma.workspaceNote.findFirst({ where: { workspaceId, body } });
        ctx.expect.ok(note === null, 'no note was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
