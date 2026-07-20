import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/closePreview/v1` — stops exposing a ticket's preview
//? (removes its proxy route only; the dev-server process is left to the container teardown
//? lifecycle). The auto-sweep already covers contract/auth/rate-limit/fuzz; these cases assert
//? what it can't reach:
//?  [1] missing `ticketKey` → `api.invalidRequest`.
//?  [2] a user with no workspace membership → `auth.forbidden` (the `workTickets` gate).
//?  [3] an authorized member closing ANY ticket's preview (even one never opened) always
//?      succeeds — `closePreviewForTicket` does no ticket/container lookup, it's an idempotent
//?      proxy-route removal, so `result.ok === true` is deterministic without Docker/proxy infra
//?      actually running (the proxy call itself never throws — network failure is swallowed).
//?
//? Integration test: `loginSeededUser` creates a real `User` + seeds a demo workspace. The
//? forbidden case adds an unrelated `createRealUser` who is never made a member. Teardown via
//? `cleanupWorkspace` (+ a bare `user.delete` for the extra non-member user).

interface CloseOk {
  status: 'success';
  result: { ok: boolean };
}
interface CloseErr {
  status: 'error';
  errorCode: string;
}
type CloseResponse = CloseOk | CloseErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'missing ticketKey returns api.invalidRequest',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'closepreview_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string }, CloseResponse>({ workspaceId });
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
      const { userId, workspaceId } = await loginSeededUser(ctx, 'closepreview_c2');
      const outsider = await createRealUser(ctx.prisma, 'closepreview_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string }, CloseResponse>({ workspaceId, ticketKey: 'DEV-1248' });
        ctx.expect.eq(res.status, 'error', 'non-member request is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', `errorCode is auth.forbidden, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await ctx.prisma.user.delete({ where: { id: outsider.id } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an authorized member closing a never-opened preview succeeds (idempotent, no Docker needed)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'closepreview_c3');
      try {
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string }, CloseResponse>({ workspaceId, ticketKey: 'DEV-1248' });
        ctx.expect.ok(res.status === 'success', `route returns status success, got ${res.status}`);
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.ok, true, 'close-preview is idempotent and always reports ok');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
