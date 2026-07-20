import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `settings/listSessions/v1` — enumerates the caller's own active
//? session tokens as opaque handles (never the raw token). The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't
//? reach:
//?  [1] a single login lists exactly one session, marked `isCurrent`.
//?  [2] logging in a second time (same user) surfaces both handles, with only the LATEST
//?      login's token marked `isCurrent` — and handles never leak the raw token.
//?
//? Integration test: `createRealUser` creates a genuine-ObjectId `User` row (this route
//? doesn't need a seeded workspace — it only reads `user.id`/`user.token` — but the login
//? fallback's synthetic id would still break any downstream `user.id` Prisma lookup, so we
//? use a real user regardless), then `ctx.session.login({ id })` establishes the session(s)
//? under test. Teardown via a direct `ctx.prisma.user.delete` since no workspace is ever
//? seeded for this route.

interface ListSessionsOk {
  status: 'success';
  result: {
    sessions: { handle: string; expiresInSeconds: number | null; isCurrent: boolean }[];
  };
}
interface ListSessionsErr {
  status: 'error';
}
type ListSessionsResponse = ListSessionsOk | ListSessionsErr;

//? Opaque handles are a 16-char lowercase-hex slice of a sha256 hash (`sessionHandle`) —
//? never the raw session token itself.
const HANDLE = /^[0-9a-f]{16}$/i;

export const customTests: CustomTestCase[] = [
  {
    name: 'a single login lists exactly one session marked isCurrent',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'listSessions_c1');
      try {
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });
        const res = await ctx.callApi<Record<string, never>, ListSessionsResponse>({});
        ctx.expect.eq(res.status, 'success', 'listSessions returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.sessions.length, 1, 'exactly one active session for a fresh single login');
        const only = res.result.sessions[0];
        ctx.expect.ok(only !== undefined, 'the single session entry exists');
        if (!only) return;
        ctx.expect.ok(HANDLE.test(only.handle), `handle (${only.handle}) is a 16-char hex opaque handle, not the raw token`);
        ctx.expect.eq(only.isCurrent, true, 'the only session is marked isCurrent');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'a second login surfaces both sessions, only the latest marked isCurrent',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'listSessions_c2');
      try {
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });
        const second = await ctx.session.login({ id: user.id, email: user.email, name: user.name });
        const res = await ctx.callApi<Record<string, never>, ListSessionsResponse>({});
        ctx.expect.eq(res.status, 'success', 'listSessions returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.sessions.length, 2, 'two active sessions after logging in twice as the same user');
        const currentOnes = res.result.sessions.filter((s) => s.isCurrent);
        ctx.expect.eq(currentOnes.length, 1, 'exactly one session is marked isCurrent');
        ctx.expect.ok(currentOnes[0] !== undefined, 'the isCurrent session corresponds to the latest login');
        void second;
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
