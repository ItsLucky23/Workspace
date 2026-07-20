import type { CustomTestCase, TestContext } from '@luckystack/test-runner';
import { updatePasswordHash } from '@luckystack/login';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `settings/requestEmailChange/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. These cases assert the business
//? logic the sweep can't reach:
//?  [1] happy path — a valid new email + the correct current password
//?      (credentials provider) either succeeds OR surfaces the route's own
//?      honest degrade `settings.emailChange.emailSendFailed` when the live
//?      email provider call itself fails. Provider-state-agnostic on purpose:
//?      whether the running server has a working email transport resolved is
//?      an environment fact this suite doesn't control (same posture as
//?      `voiceSynthesize_v1.tests.ts`) — either outcome proves the
//?      password-gate + lookup logic ran correctly; only a crash is a failure.
//?  [2] guard — a credentials-provider account that omits `currentPassword`
//?      is rejected with `settings.emailChange.currentPasswordRequired`
//?      BEFORE any token is minted (LOGIN-EMAILCHG re-auth requirement).
//?
//? Integration test: `createRealUser` creates a real Prisma `User` (a genuine
//? ObjectId), seeds a known password hash, then `ctx.session.login({ id,
//? email, name })` logs in as that user (`provider: 'credentials'` set by the
//? harness, matching the route's re-auth branch). No workspace is needed.
//? Teardown is a direct `ctx.prisma.user.delete`.

const PASSWORD = 'lstest-reqemail-Password1';

interface RequestOk {
  status: 'success';
}
interface RequestErr {
  status: 'error';
  errorCode: string;
}
type RequestResponse = RequestOk | RequestErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'valid new email + correct current password succeeds',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'reqemail_c1');
      try {
        await updatePasswordHash(user.id, PASSWORD);
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });
        const newEmail = `lstest_reqemail_c1_new_${String(Date.now())}@youcomm.nl`;

        const res = await ctx.callApi<{ newEmail: string; currentPassword?: string }, RequestResponse>({
          newEmail,
          currentPassword: PASSWORD,
        });

        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'settings.emailChange.emailSendFailed', `an error response is only the honest degrade when the live email provider call fails, got ${res.errorCode}`);
        } else {
          ctx.expect.eq(res.status, 'success', 'requestEmailChange returns status "success"');
        }

        const row = await ctx.prisma.user.findUnique({ where: { id: user.id }, select: { email: true } });
        ctx.expect.eq(row?.email, user.email, 'the stored email is unchanged until confirmation (this route only requests it)');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'missing currentPassword is rejected with settings.emailChange.currentPasswordRequired',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'reqemail_c2');
      try {
        await updatePasswordHash(user.id, PASSWORD);
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });
        const newEmail = `lstest_reqemail_c2_new_${String(Date.now())}@youcomm.nl`;

        const res = await ctx.callApi<{ newEmail: string; currentPassword?: string }, RequestResponse>({
          newEmail,
        });

        ctx.expect.eq(res.status, 'error', 'requestEmailChange returns status "error" without currentPassword');
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'settings.emailChange.currentPasswordRequired',
          'errorCode is settings.emailChange.currentPasswordRequired',
        );
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
