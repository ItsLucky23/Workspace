import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import { updatePasswordHash, verifyPassword } from '@luckystack/login';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `settings/changePassword/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. These cases assert the business
//? logic the sweep can't reach:
//?  [1] happy path — correct current password rotates the hash, and the OLD
//?      password no longer verifies against the stored hash afterward.
//?  [2] guard — a wrong `currentPassword` is rejected with `login.wrongPassword`
//?      and the stored hash is left untouched (still verifies against the OLD password).
//?
//? Integration test: `createRealUser` creates a real Prisma `User` (a genuine
//? ObjectId — required because the route reads/writes `user.id` against an
//? `@db.ObjectId` field), seeds a known password hash via `updatePasswordHash`,
//? then `ctx.session.login({ id, email, name })` logs in as that user
//? (`provider: 'credentials'` is set by the harness). No workspace is needed —
//? this route only touches the `User` row, so teardown is a direct
//? `ctx.prisma.user.delete` rather than the workspace-shaped `cleanupWorkspace`.

interface ChangePasswordOk {
  status: 'success';
  result: { revokedSessions: number };
}
interface ChangePasswordErr {
  status: 'error';
  errorCode: string;
}
type ChangePasswordResponse = ChangePasswordOk | ChangePasswordErr;

const OLD_PASSWORD = 'lstest-old-Password1';
const NEW_PASSWORD = 'lstest-new-Password2';

export const customTests: CustomTestCase[] = [
  {
    name: 'correct current password rotates the hash so the OLD password no longer verifies',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'changepw_c1');
      try {
        await updatePasswordHash(user.id, OLD_PASSWORD);
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });

        const res = await ctx.callApi<
          { currentPassword: string; newPassword: string; confirmPassword: string },
          ChangePasswordResponse
        >({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });

        ctx.expect.eq(res.status, 'success', 'changePassword returns status "success"');

        const row = await ctx.prisma.user.findUnique({ where: { id: user.id }, select: { password: true } });
        if (row?.password === undefined || row.password === null) {
          ctx.expect.ok(false, 'expected the user row to still have a password hash after rotation');
          return;
        }
        const stillOld = await verifyPassword(OLD_PASSWORD, row.password);
        ctx.expect.ok(!stillOld, 'the OLD password no longer verifies against the stored hash');
        const nowNew = await verifyPassword(NEW_PASSWORD, row.password);
        ctx.expect.ok(nowNew, 'the NEW password verifies against the stored hash');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'wrong current password is rejected with login.wrongPassword and leaves the hash untouched',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'changepw_c2');
      try {
        await updatePasswordHash(user.id, OLD_PASSWORD);
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });

        const res = await ctx.callApi<
          { currentPassword: string; newPassword: string; confirmPassword: string },
          ChangePasswordResponse
        >({ currentPassword: 'totally-wrong-password', newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });

        ctx.expect.eq(res.status, 'error', 'changePassword returns status "error" for a wrong current password');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'login.wrongPassword', 'errorCode is login.wrongPassword');

        const row = await ctx.prisma.user.findUnique({ where: { id: user.id }, select: { password: true } });
        if (row?.password === undefined || row.password === null) {
          ctx.expect.ok(false, 'expected the user row to still have a password hash');
          return;
        }
        const stillOld = await verifyPassword(OLD_PASSWORD, row.password);
        ctx.expect.ok(stillOld, 'the OLD password still verifies — the hash was not rotated on a rejected attempt');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
