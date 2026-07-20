import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import { getSessionAdapter } from '@luckystack/login';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `settings/signOutEverywhere/v1` — revokes every OTHER active
//? session for the caller, deliberately keeping the current one alive ("sign out other
//? devices, stay logged in here"). The auto-sweep already covers contract/auth/rate-limit/
//? fuzz; these cases assert the business-logic the sweep can't reach:
//?  [1] with two active sessions (current + one other), the count of revoked sessions is
//?      exactly 1, and a direct `getSessionAdapter().listActive` read confirms only the
//?      current token survives (`ctx.callApi` is scoped to THIS route only, so a sibling
//?      route like `listSessions` can't be reached through it).
//?  [2] with a single (current-only) session, revoking "everywhere" is a no-op: zero
//?      sessions revoked, and the caller's own session still lists as active afterwards.
//?
//? Integration test: `createRealUser` creates a genuine-ObjectId `User` row, then
//? `ctx.session.login({ id })` establishes the session(s) under test (called twice for
//? case 1 to get a second, non-current token to revoke). No workspace is ever seeded for
//? this route, so teardown is a direct `ctx.prisma.user.delete`.

interface SignOutOk {
  status: 'success';
  result: { revokedSessions: number };
}
interface SignOutErr {
  status: 'error';
}
type SignOutResponse = SignOutOk | SignOutErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'revokes the one other session, keeps the current session alive',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'signOutEverywhere_c1');
      try {
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });

        const res = await ctx.callApi<Record<string, never>, SignOutResponse>({});
        ctx.expect.eq(res.status, 'success', 'signOutEverywhere returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.revokedSessions, 1, 'exactly one other session was revoked');

        const remaining = await getSessionAdapter().listActive(user.id);
        ctx.expect.eq(remaining.length, 1, 'only the current session remains after signing out everywhere');
        ctx.expect.eq(remaining[0], ctx.session.current().token, 'the surviving session is the current one');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'with only the current session active, revokedSessions is 0 and the caller stays logged in',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'signOutEverywhere_c2');
      try {
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });

        const res = await ctx.callApi<Record<string, never>, SignOutResponse>({});
        ctx.expect.eq(res.status, 'success', 'signOutEverywhere returns status "success" even with no other sessions');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.revokedSessions, 0, 'nothing to revoke when only the current session is active');

        const remaining = await getSessionAdapter().listActive(user.id);
        ctx.expect.eq(remaining.length, 1, 'the caller\'s own session is still active');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
