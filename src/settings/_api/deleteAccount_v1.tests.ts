import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import { updatePasswordHash } from '@luckystack/login';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `settings/deleteAccount/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. These cases assert the business
//? logic the sweep can't reach:
//?  [1] happy path — `confirmation: 'DELETE'` + the correct current password
//?      (credentials provider) actually removes the `User` row.
//?  [2] guard — a wrong `confirmation` string is rejected with `auth.forbidden`
//?      and the `User` row survives untouched.
//?
//? Integration test: `createRealUser` creates a real Prisma `User` (a genuine
//? ObjectId — the route reads/deletes `user.id` against an `@db.ObjectId`
//? field), seeds a known password hash, then `ctx.session.login({ id, email,
//? name })` logs in as that user (`provider: 'credentials'` set by the
//? harness, matching the route's password-reconfirmation branch). No
//? workspace is needed. Case [1] does NOT clean up via `prisma.user.delete` —
//? the route itself is expected to have deleted the row, and the case
//? verifies that directly; case [2] cleans up in `finally` since the row
//? survives a rejected attempt.

const PASSWORD = 'lstest-delete-Password1';

interface DeleteOk {
  status: 'success';
  result: Record<string, never>;
}
interface DeleteErr {
  status: 'error';
  errorCode: string;
}
type DeleteResponse = DeleteOk | DeleteErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'confirmation DELETE + correct password removes the User row',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'deleteacct_c1');
      await updatePasswordHash(user.id, PASSWORD);
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });

      const res = await ctx.callApi<{ confirmation: string; password?: string }, DeleteResponse>({
        confirmation: 'DELETE',
        password: PASSWORD,
      });

      ctx.expect.eq(res.status, 'success', 'deleteAccount returns status "success"');

      const row = await ctx.prisma.user.findUnique({ where: { id: user.id } });
      ctx.expect.eq(row, null, 'the User row no longer exists after deletion');
    },
  },
  {
    name: 'wrong confirmation string is rejected with auth.forbidden and leaves the User row intact',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'deleteacct_c2');
      try {
        await updatePasswordHash(user.id, PASSWORD);
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });

        const res = await ctx.callApi<{ confirmation: string; password?: string }, DeleteResponse>({
          confirmation: 'not delete',
          password: PASSWORD,
        });

        ctx.expect.eq(res.status, 'error', 'deleteAccount returns status "error" for a wrong confirmation string');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', 'errorCode is auth.forbidden');

        const row = await ctx.prisma.user.findUnique({ where: { id: user.id } });
        ctx.expect.ok(row !== null, 'the User row still exists after a rejected confirmation');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
