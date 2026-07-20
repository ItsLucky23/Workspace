import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser, loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/openEditor/v1`. The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic layers that
//? run BEFORE the (Docker-dependent, not deterministically testable here) container
//? launch: RBAC (`hasCapability(CAP.workTickets)`), the edit-lock guard
//? (`ticketEditGuard`), and the not-activated (`ticket.branch` missing) short-circuit.
//?
//? Integration test: `loginSeededUser` creates a real `User` + logs in + seeds a demo
//? workspace/project/tickets (MIGRATION §5.2 — first-login auto-seed was removed in
//? commit 42632a2, so a workspace must be seeded explicitly). Teardown via the shared
//? `cleanupWorkspace` harness helper.

interface OpenEditorErr { status: 'error'; errorCode: string }
interface OpenEditorLocked { status: 'success'; result: { ok: false; error: string } }
type OpenEditorResponse = OpenEditorErr | OpenEditorLocked | { status: 'success'; result: { ok: true; url: string; token: string } };

export const customTests: CustomTestCase[] = [
  {
    name: 'missing workspaceId/ticketKey returns api.invalidRequest',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'openEditor_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string }, OpenEditorResponse>({
          workspaceId, ticketKey: '',
        });
        ctx.expect.eq(res.status, 'error', 'empty ticketKey is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'api.invalidRequest', 'errorCode is api.invalidRequest');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a user with no membership on the workspace is refused with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'openEditor_c2_owner');
      const outsider = await createRealUser(ctx.prisma, 'openEditor_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId }, select: { key: true } });
        ctx.expect.ok(ticket !== null, 'the seeded workspace has at least one ticket');
        if (!ticket) return;
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string }, OpenEditorResponse>({
          workspaceId, ticketKey: ticket.key,
        });
        ctx.expect.eq(res.status, 'error', 'a non-member is refused');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', 'errorCode is auth.forbidden');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [ownerId, outsider.id]);
      }
    },
  },
  {
    name: 'a member opening an editor on a not-yet-activated ticket (no branch) gets editor.notActivated',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'openEditor_c3');
      try {
        const ticket = await ctx.prisma.ticket.findFirst({ where: { workspaceId, branch: null }, select: { key: true } });
        ctx.expect.ok(ticket !== null, 'the seeded workspace has a not-yet-activated ticket (branch === null)');
        if (!ticket) return;
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string }, OpenEditorResponse>({
          workspaceId, ticketKey: ticket.key,
        });
        ctx.expect.eq(res.status, 'error', 'the RBAC + edit-lock guard both pass, so the notActivated check is reached');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'editor.notActivated', 'errorCode is editor.notActivated');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
