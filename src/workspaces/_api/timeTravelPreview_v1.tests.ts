import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/timeTravelPreview/v1` (T3) — resolves a time-travel spec
//? (raw commit / "main minus X" revert / "as of timestamp T") to a concrete ref, then opens the
//? T1 ephemeral ref-preview. The auto-sweep already covers contract/auth/rate-limit/fuzz; these
//? cases assert what it can't reach:
//?  [1] an invalid `spec.kind` → `api.invalidRequest` (the route's own shape guard on the
//?      untrusted `relaxed`-validation input).
//?  [2] a user with no workspace membership → `auth.forbidden` (the `workTickets` gate).
//?  [3] a `ticketKey` that doesn't exist in the workspace → `api.invalidRequest` (the R3-b
//?      project-resolution lookup this route does before resolving the spec).
//?  [4] an authorized member with a `kind: 'commit'` spec whose `value` fails `isSafeRef` (e.g.
//?      contains a space) → the route still returns `status: 'success'` with
//?      `result.ok === false, result.error === 'ref.unsafe'` — `resolveRefSpec` rejects a
//?      `commit` spec's unsafe value BEFORE any git/Docker call, so this is deterministic
//?      without a bare-mirror repo or a container runtime.
//?
//? Integration test: `loginSeededUser` creates a real `User` + seeds a demo workspace. The
//? forbidden case adds an unrelated `createRealUser` who is never made a member. Teardown via
//? `cleanupWorkspace` (+ a bare `user.delete` for the extra non-member user).

interface TimeTravelOk {
  status: 'success';
  result: { ok: boolean; url?: string; host?: string; ref?: string; conflict?: boolean; error?: string };
}
interface TimeTravelErr {
  status: 'error';
  errorCode: string;
}
type TimeTravelResponse = TimeTravelOk | TimeTravelErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'invalid spec.kind returns api.invalidRequest',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'timetravel_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string; branch: string; spec: { kind: string } }, TimeTravelResponse>({
          workspaceId, ticketKey: 'DEV-1248', branch: 'main', spec: { kind: 'bogus' },
        });
        ctx.expect.eq(res.status, 'error', 'an unrecognized spec.kind is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'api.invalidRequest', `errorCode is api.invalidRequest, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a user with no workspace membership is forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'timetravel_c2');
      const outsider = await createRealUser(ctx.prisma, 'timetravel_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string; branch: string; spec: { kind: string; value: string } }, TimeTravelResponse>({
          workspaceId, ticketKey: 'DEV-1248', branch: 'main', spec: { kind: 'commit', value: 'abc123' },
        });
        ctx.expect.eq(res.status, 'error', 'non-member request is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', `errorCode is auth.forbidden, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await ctx.prisma.user.delete({ where: { id: outsider.id } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a non-existent ticketKey returns api.invalidRequest',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'timetravel_c3');
      try {
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string; branch: string; spec: { kind: string; value: string } }, TimeTravelResponse>({
          workspaceId, ticketKey: 'DEV-NOPE', branch: 'main', spec: { kind: 'commit', value: 'abc123' },
        });
        ctx.expect.eq(res.status, 'error', 'a ticket that does not exist is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'api.invalidRequest', `errorCode is api.invalidRequest, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an authorized member with an unsafe commit value gets ref.unsafe (no git/Docker needed)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'timetravel_c4');
      try {
        const res = await ctx.callApi<{ workspaceId: string; ticketKey: string; branch: string; spec: { kind: string; value: string } }, TimeTravelResponse>({
          workspaceId, ticketKey: 'DEV-1248', branch: 'main', spec: { kind: 'commit', value: 'bad ref!' },
        });
        ctx.expect.ok(res.status === 'success', `route returns status success, got ${res.status}`);
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.ok, false, 'the spec did not resolve for an unsafe ref value');
        ctx.expect.eq(res.result.error, 'ref.unsafe', 'error is ref.unsafe');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
