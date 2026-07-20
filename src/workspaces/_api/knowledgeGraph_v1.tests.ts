import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/knowledgeGraph/v1`. The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't
//? reach:
//?  [1] a member with `workTickets` gets a graph whose `ticket` nodes cover the demo-seeded
//?      (non-archived) tickets — one `GraphNode` per ticket, `type: 'ticket'`, `id` shaped
//?      `ticket:<ticketId>`.
//?  [2] a caller with no membership on the target workspace is rejected with
//?      `auth.forbidden`.
//?
//? Integration test: `loginSeededUser` creates a real `User` + seeds a demo workspace (owner
//? role, full perms — `workTickets`; the demo seed also populates real `Ticket` rows), logs
//? in as the owner. Teardown via `cleanupWorkspace`.

interface KnowledgeGraphOk {
  status: 'success';
  result: { nodes: { id: string; type: string; label: string }[]; edges: { from: string; to: string; kind: string; weight: number }[] };
}
interface KnowledgeGraphErr {
  status: 'error';
  errorCode: string;
}
type KnowledgeGraphResponse = KnowledgeGraphOk | KnowledgeGraphErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a member with workTickets gets one ticket node per demo-seeded non-archived ticket',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'kgraph_c1');
      try {
        const tickets = await ctx.prisma.ticket.findMany({ where: { workspaceId, archived: false }, select: { id: true } });
        ctx.expect.ok(tickets.length > 0, 'the demo seed produced at least one non-archived ticket');
        if (tickets.length === 0) return;

        const res = await ctx.callApi<{ workspaceId: string }, KnowledgeGraphResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'knowledgeGraph returns status "success" for a member');
        if (res.status !== 'success') return;
        ctx.expect.ok(Array.isArray(res.result.nodes), 'result.nodes is an array');
        const ticketNodes = res.result.nodes.filter((n) => n.type === 'ticket');
        ctx.expect.eq(ticketNodes.length, tickets.length, 'one ticket node exists per demo-seeded ticket');
        const ticketNodeIds = new Set(ticketNodes.map((n) => n.id));
        ctx.expect.ok(
          tickets.every((t) => ticketNodeIds.has(`ticket:${t.id}`)),
          'every ticket node id is shaped "ticket:<ticketId>"',
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a caller with no membership on the target workspace is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'kgraph_c2');
      try {
        const foreignWorkspaceId = '0'.repeat(24);
        const res = await ctx.callApi<{ workspaceId: string }, KnowledgeGraphResponse>({ workspaceId: foreignWorkspaceId });
        ctx.expect.eq(res.status, 'error', 'knowledgeGraph rejects a caller with no membership');
        if (res.status !== 'error') return;
        ctx.expect.eq(res.errorCode, 'auth.forbidden', 'errorCode is auth.forbidden');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
