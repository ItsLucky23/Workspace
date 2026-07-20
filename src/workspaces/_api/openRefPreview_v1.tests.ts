import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/openRefPreview/v1` (T1) — starts a ticket's app at an
//? arbitrary git ref in an ephemeral, ref-scoped container. The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert what it can't reach:
//?  [1] missing `ref` → `api.invalidRequest`.
//?  [2] a user with no workspace membership → `auth.forbidden` (the `workTickets` gate).
//?  [3] an authorized member with an UNSAFE `ref` (fails `isSafeRef`, e.g. contains a space) →
//?      the route still returns `status: 'success'` with `result.ok === false,
//?      result.error === 'preview.badRef'` — `openRefPreview` rejects the ref BEFORE any ticket
//?      lookup or Docker call, so this is deterministic without a container runtime.
//?
//? Integration test: `loginSeededUser` creates a real `User` + seeds a demo workspace. The
//? forbidden case adds an unrelated `createRealUser` who is never made a member. Teardown via
//? `cleanupWorkspace` (+ a bare `user.delete` for the extra non-member user).

interface RefPreviewOk {
  status: 'success';
  result: { ok: boolean; url?: string; host?: string; ref?: string; error?: string };
}
interface RefPreviewErr {
  status: 'error';
  errorCode: string;
}
type RefPreviewResponse = RefPreviewOk | RefPreviewErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'missing ref returns api.invalidRequest',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'openrefpreview_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string }, RefPreviewResponse>({ workspaceId, ticketKey: 'DEV-1248' });
        ctx.expect.eq(res.status, 'error', 'missing ref is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'api.invalidRequest', `errorCode is api.invalidRequest, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a user with no workspace membership is forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'openrefpreview_c2');
      const outsider = await createRealUser(ctx.prisma, 'openrefpreview_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string; ref: string }, RefPreviewResponse>({ workspaceId, ticketKey: 'DEV-1248', ref: 'main' });
        ctx.expect.eq(res.status, 'error', 'non-member request is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', `errorCode is auth.forbidden, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await ctx.prisma.user.delete({ where: { id: outsider.id } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an authorized member with an unsafe ref gets preview.badRef (no Docker needed)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'openrefpreview_c3');
      try {
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string; ref: string }, RefPreviewResponse>({ workspaceId, ticketKey: 'DEV-1248', ref: 'bad ref!' });
        ctx.expect.ok(res.status === 'success', `route returns status success, got ${res.status}`);
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.ok, false, 'preview did not start for an unsafe ref');
        ctx.expect.eq(res.result.error, 'preview.badRef', 'error is preview.badRef');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
