import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import { createEmailChangeToken } from '@luckystack/login';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `settings/confirmEmailChange/v1`. `auth.login: false` —
//? the one-shot Redis token IS the auth, so the auto-sweep's auth-enforcement
//? layer does not apply here. The sweep still covers contract/rate-limit/fuzz.
//? These cases assert the business logic the sweep can't reach:
//?  [1] happy path — a valid token mints via `createEmailChangeToken`, consuming
//?      it flips the user's stored email and is reflected in the DB row.
//?  [2] guard — an invalid/unknown token is rejected with
//?      `settings.emailChange.invalidToken` and leaves the stored email untouched.
//?
//? Integration test: `createRealUser` creates a real Prisma `User` (a genuine
//? ObjectId — the route reads/writes `user.id` against an `@db.ObjectId`
//? field). No login/session is needed since `auth.login: false` — the case
//? mints a real one-shot token via `createEmailChangeToken` instead. No
//? workspace is needed. Teardown is a direct `ctx.prisma.user.delete`.

interface ConfirmOk {
  status: 'success';
  result: { revokedSessions: number };
}
interface ConfirmErr {
  status: 'error';
  errorCode: string;
}
type ConfirmResponse = ConfirmOk | ConfirmErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a valid token flips the stored email to the new address',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'confirmemail_c1');
      const newEmail = `lstest_confirmemail_c1_new_${String(Date.now())}@youcomm.nl`;
      try {
        const token = await createEmailChangeToken(user.id, newEmail);

        const res = await ctx.callApi<{ token: string }, ConfirmResponse>({ token });

        ctx.expect.eq(res.status, 'success', 'confirmEmailChange returns status "success"');

        const row = await ctx.prisma.user.findUnique({ where: { id: user.id }, select: { email: true } });
        ctx.expect.eq(row?.email, newEmail, 'the stored email was updated to the new address');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'an invalid token is rejected with settings.emailChange.invalidToken and leaves the email untouched',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'confirmemail_c2');
      try {
        const res = await ctx.callApi<{ token: string }, ConfirmResponse>({ token: 'not-a-real-token' });

        ctx.expect.eq(res.status, 'error', 'confirmEmailChange returns status "error" for an invalid token');
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'settings.emailChange.invalidToken',
          'errorCode is settings.emailChange.invalidToken',
        );

        const row = await ctx.prisma.user.findUnique({ where: { id: user.id }, select: { email: true } });
        ctx.expect.eq(row?.email, user.email, 'the stored email is unchanged after a rejected confirmation');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
