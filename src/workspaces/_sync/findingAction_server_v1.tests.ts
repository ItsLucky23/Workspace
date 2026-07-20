import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/findingAction/v1` — Interviewer finding writes (ADR
//? 0034). `op` selects the control-op: `finding-to-ticket` (a human turns a finding into a
//? ticket) or `finding-dismiss`. Both dispatch through `dispatchControlSync` → the Conductor.
//?  [1] happy path — 'finding-to-ticket' on an open InterviewFinding creates a Ticket and
//?      flips the finding to 'accepted' with `ticketId` set; asserted via the REAL Prisma
//?      post-condition, not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` is rejected
//?      with `auth.forbidden`, and the finding is left untouched (still 'open').

interface FindingActionInput { op: string; clientRequestId: string; findingId?: string; projectId?: string }
interface FindingActionOk { status: 'success' }
interface FindingActionErr { status: 'error'; errorCode: string }
type FindingActionResponse = FindingActionOk | FindingActionErr;

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
    name: 'happy path: finding-to-ticket creates a ticket + accepts the finding (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'findingaction_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const finding = await ctx.prisma.interviewFinding.create({
          data: { workspaceId, area: 'reliability', severity: 'normal', title: `Finding ${String(Date.now())}`, summary: 'A test finding', status: 'open' },
        });

        const res = await ctx.callSync<FindingActionInput, FindingActionResponse>(
          { op: 'finding-to-ticket', clientRequestId: `fa-c1-${String(Date.now())}`, findingId: finding.id, projectId: project.id },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'finding-to-ticket returns status "success"');

        const updated = await poll(() => ctx.prisma.interviewFinding.findFirst({ where: { workspaceId, id: finding.id, status: 'accepted' } }));
        ctx.expect.ok(updated !== null, 'the Conductor flipped the finding to accepted (post-condition, not just the ack)');
        ctx.expect.ok(typeof updated?.ticketId === 'string', 'the finding is linked to the newly-created ticket');

        const ticket = updated?.ticketId ? await ctx.prisma.ticket.findFirst({ where: { workspaceId, id: updated.ticketId } }) : null;
        ctx.expect.ok(ticket !== null, 'the Conductor persisted the ticket');
        ctx.expect.eq(ticket?.title, finding.title, 'the ticket title carries the finding title');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'findingaction_c2');
      const outsider = await createRealUser(ctx.prisma, 'findingaction_c2_outsider');
      try {
        const finding = await ctx.prisma.interviewFinding.create({
          data: { workspaceId, area: 'dx', severity: 'normal', title: `Outsider finding ${String(Date.now())}`, summary: 'A test finding', status: 'open' },
        });

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<FindingActionInput, FindingActionResponse>(
          { op: 'finding-dismiss', clientRequestId: `fa-c2-${String(Date.now())}`, findingId: finding.id },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const unchanged = await ctx.prisma.interviewFinding.findFirst({ where: { workspaceId, id: finding.id } });
        ctx.expect.eq(unchanged?.status, 'open', 'the finding was left untouched by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
