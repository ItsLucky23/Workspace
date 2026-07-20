import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser, loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveWorktreeFile/v1`. The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert what runs BEFORE the (Docker-dependent,
//? not deterministically testable here) container exec: RBAC (`hasCapability(CAP.workTickets)`),
//? the stage/edit-lock guard (`ticketEditGuard` — same C4 lock the live editor uses), and
//? `isSafeWorktreePath` (checked before `dockerAvailable()`, so a traversal path is refused
//? deterministically regardless of whether Docker is installed in this environment).
//?
//? Integration test: `loginSeededUser` creates a real `User` + logs in + seeds a demo
//? workspace/project/tickets. Teardown via the shared `cleanupWorkspace` harness helper.

interface SaveErr { status: 'error'; errorCode: string }
interface SaveOk { status: 'success'; result: { ok: boolean; error?: string } }
type SaveResponse = SaveErr | SaveOk;

export const customTests: CustomTestCase[] = [
  {
    name: 'missing path returns api.invalidRequest',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveWorktree_c1');
      try {
        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId }, select: { key: true } });
        ctx.expect.ok(ticket !== null, 'the seeded workspace has at least one ticket');
        if (!ticket) return;
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string; path: string; content: string }, SaveResponse>({
          workspaceId, ticketKey: ticket.key, path: '', content: 'hi',
        });
        ctx.expect.eq(res.status, 'error', 'empty path is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'api.invalidRequest', 'errorCode is api.invalidRequest');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a user with no membership on the workspace is refused with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'saveWorktree_c2_owner');
      const outsider = await createRealUser(ctx.prisma, 'saveWorktree_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId }, select: { key: true } });
        ctx.expect.ok(ticket !== null, 'the seeded workspace has at least one ticket');
        if (!ticket) return;
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string; path: string; content: string }, SaveResponse>({
          workspaceId, ticketKey: ticket.key, path: 'README.md', content: 'hi',
        });
        ctx.expect.eq(res.status, 'error', 'a non-member is refused');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', 'errorCode is auth.forbidden');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [ownerId, outsider.id]);
      }
    },
  },
  {
    name: 'saving to a non-existent ticket is refused by the edit-lock guard (editor.ticketNotFound)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveWorktree_c3');
      try {
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string; path: string; content: string }, SaveResponse>({
          workspaceId, ticketKey: 'DEV-9999999', path: 'README.md', content: 'hi',
        });
        ctx.expect.eq(res.status, 'success', 'the route still returns a success envelope (the guard refused the write, not the request)');
        ctx.expect.ok(res.status === 'success' && !res.result.ok && res.result.error === 'editor.ticketNotFound', 'result.ok is false with error editor.ticketNotFound');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a path-traversal attempt is refused with editor.pathInvalid before Docker is touched',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveWorktree_c4');
      try {
        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId }, select: { key: true } });
        ctx.expect.ok(ticket !== null, 'the seeded workspace has at least one ticket (userEditable defaults true, no busy agent, so the edit-lock guard passes)');
        if (!ticket) return;
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string; path: string; content: string }, SaveResponse>({
          workspaceId, ticketKey: ticket.key, path: '../../etc/passwd', content: 'pwned',
        });
        ctx.expect.eq(res.status, 'success', 'the route still returns a success envelope (the write itself failed, not the request)');
        ctx.expect.ok(res.status === 'success' && !res.result.ok && res.result.error === 'editor.pathInvalid', 'result.ok is false with error editor.pathInvalid');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
