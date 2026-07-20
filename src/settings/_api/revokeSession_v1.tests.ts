import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import { createHash } from 'node:crypto';
import { getSessionAdapter } from '@luckystack/login';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `settings/revokeSession/v1` — deletes a session the caller owns,
//? identified by the opaque handle `listSessions_v1` hands out. The auto-sweep already
//? covers contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep
//? can't reach:
//?  [1] revoking a NON-current session for the same user actually deletes it (post-condition
//?      verified directly through `getSessionAdapter().listActive` — the same adapter
//?      surface the route itself reads/writes; `ctx.callApi` is scoped to THIS route only,
//?      so a sibling route like `listSessions` can't be reached through it).
//?  [2] the current session's own handle is refused with `session.invalid` — a user must
//?      log out, not "revoke", their active session.
//?
//? Integration test: `createRealUser` creates a genuine-ObjectId `User` row, then
//? `ctx.session.login({ id })` (called twice, to get two distinct session tokens for the
//? same user) establishes the sessions under test. No workspace is ever seeded for this
//? route, so teardown is a direct `ctx.prisma.user.delete`.

const sessionHandle = (token: string): string => createHash('sha256').update(token).digest('hex').slice(0, 16);

interface RevokeOk {
  status: 'success';
  result: Record<string, never>;
}
interface RevokeErr {
  status: 'error';
  errorCode?: string;
}
type RevokeResponse = RevokeOk | RevokeErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'revoking a non-current session removes it (verified via listSessions)',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'revokeSession_c1');
      try {
        const first = await ctx.session.login({ id: user.id, email: user.email, name: user.name });
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });
        const targetHandle = sessionHandle(first.token);

        const res = await ctx.callApi<{ handle: string }, RevokeResponse>({ handle: targetHandle });
        ctx.expect.eq(res.status, 'success', 'revoking the non-current session succeeds');

        const remaining = await getSessionAdapter().listActive(user.id);
        ctx.expect.ok(
          !remaining.some((token) => sessionHandle(token) === targetHandle),
          'the revoked handle no longer appears among the user\'s active sessions',
        );
        ctx.expect.eq(remaining.length, 1, 'only the remaining (current) session is left');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'revoking the caller\'s own current session is refused with session.invalid',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'revokeSession_c2');
      try {
        const current = await ctx.session.login({ id: user.id, email: user.email, name: user.name });
        const res = await ctx.callApi<{ handle: string }, RevokeResponse>({ handle: sessionHandle(current.token) });
        ctx.expect.eq(res.status, 'error', 'revoking the current session is refused');
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'session.invalid',
          `errorCode is session.invalid, got ${res.status === 'error' ? String(res.errorCode) : 'n/a'}`,
        );
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
