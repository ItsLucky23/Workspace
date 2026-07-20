import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import { createPasswordResetToken, verifyPassword } from '@luckystack/login';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `reset-password/confirmReset/v1`. The auto-sweep already covers
//? contract/rate-limit/fuzz (auth is `login: false`). These cases assert the business-logic
//? the sweep can't reach:
//?  [1] a valid one-time reset token + a policy-passing password actually updates the user's
//?      password hash (observed via `verifyPassword` from `@luckystack/login`).
//?  [2] confirmPassword mismatch is rejected with `login.passwordNotMatch` and does NOT
//?      consume the token (the route validates the match BEFORE calling
//?      `consumePasswordResetToken`).
//?  [3] the reset token is single-use — replaying an already-consumed token returns
//?      `login.resetInvalidToken`.
//?
//? Integration test: `createRealUser` creates a real Prisma `User` (a genuine ObjectId) with no
//? password set. `createPasswordResetToken` (the same helper `sendReset` calls internally) mints
//? a real one-time token for it, bypassing email delivery. No login/session is needed — this
//? route is unauthenticated by design. Teardown deletes the created user directly.

interface ConfirmOk {
  status: 'success';
  result: Record<string, never>;
}
interface ConfirmErr {
  status: 'error';
  errorCode: string;
}
type ConfirmResponse = ConfirmOk | ConfirmErr;

const NEW_PASSWORD = 'TestReset1234!';

export const customTests: CustomTestCase[] = [
  {
    name: 'a valid token + matching policy-passing passwords updates the password hash',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'confirmreset_c1');
      try {
        const token = await createPasswordResetToken(user.id);
        const res = await ctx.callApi<{ token: string; password: string; confirmPassword: string }, ConfirmResponse>({
          token,
          password: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        });
        ctx.expect.eq(res.status, 'success', 'confirmReset returns status "success" for a valid token');

        const row = await ctx.prisma.user.findUnique({ where: { id: user.id }, select: { password: true } });
        ctx.expect.ok(row?.password !== null && row?.password !== undefined, 'user row now has a password hash set');
        if (!row?.password) return;
        const matches = await verifyPassword(NEW_PASSWORD, row.password);
        ctx.expect.ok(matches, 'the stored hash verifies against the new password');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'mismatched confirmPassword is rejected and the token stays usable',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'confirmreset_c2');
      try {
        const token = await createPasswordResetToken(user.id);
        const badRes = await ctx.callApi<{ token: string; password: string; confirmPassword: string }, ConfirmResponse>({
          token,
          password: NEW_PASSWORD,
          confirmPassword: 'SomethingElse1!',
        });
        ctx.expect.eq(badRes.status, 'error', 'mismatched passwords return status "error"');
        ctx.expect.ok(badRes.status === 'error' && badRes.errorCode === 'login.passwordNotMatch', 'errorCode is login.passwordNotMatch');

        //? The token must still be redeemable — the mismatch was validated before any
        //? consumePasswordResetToken call.
        const goodRes = await ctx.callApi<{ token: string; password: string; confirmPassword: string }, ConfirmResponse>({
          token,
          password: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        });
        ctx.expect.eq(goodRes.status, 'success', 'the same token is still redeemable after a validation-only failure');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'replaying an already-consumed token is rejected as invalid',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'confirmreset_c3');
      try {
        const token = await createPasswordResetToken(user.id);
        const first = await ctx.callApi<{ token: string; password: string; confirmPassword: string }, ConfirmResponse>({
          token,
          password: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        });
        ctx.expect.eq(first.status, 'success', 'first redemption succeeds');

        const replay = await ctx.callApi<{ token: string; password: string; confirmPassword: string }, ConfirmResponse>({
          token,
          password: 'AnotherPass123!',
          confirmPassword: 'AnotherPass123!',
        });
        ctx.expect.eq(replay.status, 'error', 'replaying a consumed token returns status "error"');
        ctx.expect.ok(replay.status === 'error' && replay.errorCode === 'login.resetInvalidToken', 'errorCode is login.resetInvalidToken');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
