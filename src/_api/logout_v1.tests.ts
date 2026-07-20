import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import { getSession } from '@luckystack/login';

import { createRealUser } from '../../tests/_helpers.mjs';

//? Per-route tests for `/logout/v1`. The auto-sweep already covers contract/rate-limit/fuzz
//? (auth is `login: false` — no auth-enforcement layer applies here). These cases assert the
//? business-logic the sweep can't reach:
//?  [1] logging out an authenticated user actually deletes the server-side session (observed
//?      via `getSession(token)` from `@luckystack/login` — the same adapter the route calls).
//?  [2] calling logout with NO session is a safe no-op (still `status: 'success'`), matching
//?      the route's `if (user?.token)` guard.
//?
//? Integration test: `createRealUser` creates a real Prisma `User` (a genuine ObjectId), then
//? `ctx.session.login({ id, email, name })` establishes a real session token via the harness's
//? cookie jar so `ctx.callApi` sends it. Teardown deletes the created user directly (this route
//? never touches workspace data, so no `cleanupWorkspace` call is needed).

interface LogoutResponse {
  status: 'success';
  result: boolean;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'logging out an authenticated user deletes the server-side session',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'logout_c1');
      try {
        const { token } = await ctx.session.login({ id: user.id, email: user.email, name: user.name });
        const before = await getSession(token);
        ctx.expect.ok(before !== null, 'session exists right after login');

        const res = await ctx.callApi<Record<string, never>, LogoutResponse>({});
        ctx.expect.eq(res.status, 'success', 'logout returns status "success"');
        ctx.expect.eq(res.result, true, 'logout result is true');

        const after = await getSession(token);
        ctx.expect.eq(after, null, 'session no longer resolves after logout');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'calling logout without a session is a safe no-op',
    run: async (ctx: TestContext) => {
      await ctx.session.logout();
      const res = await ctx.callApi<Record<string, never>, LogoutResponse>({});
      ctx.expect.eq(res.status, 'success', 'logout without a session still returns "success"');
      ctx.expect.eq(res.result, true, 'logout without a session still returns result true');
    },
  },
];
