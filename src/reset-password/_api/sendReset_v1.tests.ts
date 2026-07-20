import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `reset-password/sendReset/v1`. The auto-sweep already covers
//? contract/rate-limit/fuzz (auth is `login: false`). These cases assert the business-logic
//? the sweep can't reach:
//?  [1] a registered credentials-account email returns the same `{ status: 'success' }`
//?      envelope as an unregistered one (the route's documented anti-enumeration contract —
//?      "Always returns ok=true even if the email isn't recognized").
//?  [2] a syntactically invalid email is rejected with `login.invalidEmailFormat` BEFORE any
//?      lookup/send attempt.
//?
//? Integration test: `createRealUser` creates a real Prisma `User` (a genuine ObjectId, default
//? `provider: credentials` per the schema) so the "known email" case has a real
//? credentials-account to match against. No login/session is needed — this route is
//? unauthenticated by design. Teardown deletes the created user directly.

interface SendResetOk {
  status: 'success';
  result: Record<string, never>;
}
interface SendResetErr {
  status: 'error';
  errorCode: string;
}
type SendResetResponse = SendResetOk | SendResetErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a registered and an unregistered email get the identical success envelope (anti-enumeration)',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'sendreset_c1');
      try {
        const knownRes = await ctx.callApi<{ email: string }, SendResetResponse>({ email: user.email });
        ctx.expect.eq(knownRes.status, 'success', 'a known credentials-account email returns "success"');

        const unknownRes = await ctx.callApi<{ email: string }, SendResetResponse>({
          email: `lstest_sendreset_unregistered_${String(Date.now())}@youcomm.nl`,
        });
        ctx.expect.eq(unknownRes.status, 'success', 'an unregistered email also returns "success" (no enumeration leak)');
        ctx.expect.eq(knownRes.status, unknownRes.status, 'both responses have the identical status');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'a syntactically invalid email is rejected before any lookup',
    run: async (ctx: TestContext) => {
      const res = await ctx.callApi<{ email: string }, SendResetResponse>({ email: 'not-an-email' });
      ctx.expect.eq(res.status, 'error', 'invalid email format returns status "error"');
      ctx.expect.ok(res.status === 'error' && res.errorCode === 'login.invalidEmailFormat', 'errorCode is login.invalidEmailFormat');
    },
  },
];
