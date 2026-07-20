import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/openPreview/v1` — starts a ticket's app dev-server in its
//? container and exposes it at the preview subdomain. The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert what it can't reach:
//?  [1] missing `ticketKey` → `api.invalidRequest` (the route's own field guard).
//?  [2] a user with no membership in the workspace → `auth.forbidden` (the `workTickets` gate).
//?  [3] an authorized member previewing a ticket that was never activated (no `branch`,
//?      e.g. seeded `DEV-1248`) → the route still returns `status: 'success'` with
//?      `result.ok === false, result.error === 'preview.notActivated'` — `openPreviewForTicket`
//?      short-circuits BEFORE touching Docker, so this is deterministic without a container runtime.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) + seeds a demo
//? workspace (first-login auto-seed was removed — onboarding now owns that path). The forbidden
//? case additionally creates an unrelated `createRealUser` who is never added as a member.
//? Teardown via `cleanupWorkspace` (+ a bare `user.delete` for the extra non-member user).

interface PreviewOk {
  status: 'success';
  result: { ok: boolean; url?: string; host?: string; error?: string };
}
interface PreviewErr {
  status: 'error';
  errorCode: string;
}
type PreviewResponse = PreviewOk | PreviewErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'missing ticketKey returns api.invalidRequest',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'openpreview_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string }, PreviewResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'error', 'missing ticketKey is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'api.invalidRequest', `errorCode is api.invalidRequest, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a user with no workspace membership is forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'openpreview_c2');
      const outsider = await createRealUser(ctx.prisma, 'openpreview_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string }, PreviewResponse>({ workspaceId, ticketKey: 'DEV-1248' });
        ctx.expect.eq(res.status, 'error', 'non-member request is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', `errorCode is auth.forbidden, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await ctx.prisma.user.delete({ where: { id: outsider.id } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an authorized member previewing a never-activated ticket gets preview.notActivated (no Docker needed)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'openpreview_c3');
      try {
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string }, PreviewResponse>({ workspaceId, ticketKey: 'DEV-1248' });
        ctx.expect.ok(res.status === 'success', `route returns status success, got ${res.status}`);
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.ok, false, 'preview did not start for a never-activated ticket');
        ctx.expect.eq(res.result.error, 'preview.notActivated', 'error is preview.notActivated');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
