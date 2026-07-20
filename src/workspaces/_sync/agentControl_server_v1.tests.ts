import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/agentControl/v1` — the engine controls (pause/resume/
//? kill a ticket's autonomous turn, pause-all/resume-all for the workspace), dispatched
//? through the single-writer Conductor (RBAC-gated: `pause`/`resume` = workTickets,
//? `kill`/`pause-all`/`resume-all` = demoteAdmin). The auto-sweep does not walk `_sync`
//? routes, so these cases also stand in for basic contract/auth coverage.
//?
//? `resume` re-fires the ticket's turn via `reprovisionTicket` and `kill` inspects the
//? live `AgentSession`/container — both Docker/PTY-dependent, so their happy paths are
//? deferred (see the TODO below; container-dependent cases are out of scope for this
//? batch). `pause`, by contrast, is a pure Prisma write (`conductor.ts` case 'pause' —
//? only `ticket.updateMany` + a broadcast, no container touch), so it is safe to prove
//? end-to-end here:
//?  [1] happy path — `pause` on a real (seeded-demo) ticket flips its `status` to
//?      'paused'; asserted via the REAL Prisma post-condition, not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and the ticket is left untouched.
//?
//? //? TODO needs Docker — `resume` (reprovisionTicket) and `kill` (AgentSession/container
//? inspection) happy paths are container-dependent and are NOT covered by this batch.

interface AgentControlInput {
  op: string;
  ticketKey?: string;
  clientRequestId: string;
}
interface AgentControlOk {
  status: 'success';
  workspacePaused?: boolean;
}
interface AgentControlErr {
  status: 'error';
  errorCode: string;
}
type AgentControlResponse = AgentControlOk | AgentControlErr;

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
    name: 'happy path: pause on a real ticket flips status to paused (Docker-free op; Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'agentcontrol_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const seededTicket = await ctx.prisma.ticket.findFirst({ where: { workspaceId } });
        ctx.expect.ok(seededTicket !== null, 'the demo seed provided at least one ticket to pause');
        const ticketKey = seededTicket?.key ?? '';

        const res = await ctx.callSync<AgentControlInput, AgentControlResponse>(
          { op: 'pause', ticketKey, clientRequestId: `ac-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'agentControl returns status "success"');

        const paused = await poll(async () => {
          const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey } });
          return ticket?.status === 'paused' ? ticket : null;
        });
        ctx.expect.ok(paused !== null, 'the Conductor persisted the ticket status as "paused" (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'agentcontrol_c2');
      const outsider = await createRealUser(ctx.prisma, 'agentcontrol_c2_outsider');
      try {
        const seededTicket = await ctx.prisma.ticket.findFirst({ where: { workspaceId } });
        const ticketKey = seededTicket?.key ?? '';

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<AgentControlInput, AgentControlResponse>(
          { op: 'pause', ticketKey, clientRequestId: `ac-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey } });
        ctx.expect.eq(ticket?.status, seededTicket?.status, 'the ticket status was left untouched by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
