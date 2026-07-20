import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser } from '../../tests/_helpers.mjs';

//? Per-route tests for `/session/v1`. The auto-sweep already covers contract/rate-limit/fuzz
//? (auth is `login: false` — the route itself branches on presence of `user`, so there's no
//? auth-enforcement layer to sweep). These cases assert the business-logic the sweep can't
//? reach:
//?  [1] an authenticated caller gets back their own session, with `token`/`csrfToken` stripped
//?      (the route's documented XSS/CSRF-secret-hiding contract).
//?  [2] an unauthenticated caller gets `{ status: 'success', result: null }`, not an error.
//?
//? Integration test: `createRealUser` creates a real Prisma `User` (a genuine ObjectId), then
//? `ctx.session.login({ id, email, name })` establishes a real session token via the harness's
//? cookie jar so `ctx.callApi` sends it. Teardown deletes the created user directly (this route
//? never touches workspace data, so no `cleanupWorkspace` call is needed).

interface SessionOk {
  status: 'success';
  result: { id: string; email: string; token?: string; csrfToken?: string } | null;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'authenticated caller receives their own session with token/csrfToken stripped',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'session_c1');
      try {
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });
        const res = await ctx.callApi<Record<string, never>, SessionOk>({});
        ctx.expect.eq(res.status, 'success', 'session returns status "success"');
        ctx.expect.ok(res.result !== null, 'result is non-null for an authenticated caller');
        if (res.result === null) return;
        ctx.expect.eq(res.result.id, user.id, 'result.id is the logged-in user id');
        ctx.expect.eq(res.result.email, user.email, 'result.email is the logged-in user email');
        ctx.expect.ok(!('token' in res.result), 'result does not expose the raw session token');
        ctx.expect.ok(!('csrfToken' in res.result), 'result does not expose the csrf secret');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'unauthenticated caller receives a success envelope with a null result',
    run: async (ctx: TestContext) => {
      await ctx.session.logout();
      const res = await ctx.callApi<Record<string, never>, SessionOk>({});
      ctx.expect.eq(res.status, 'success', 'no-session call still returns status "success"');
      ctx.expect.eq(res.result, null, 'no-session call returns a null result, not an error');
    },
  },
];
