import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `settings/updatePreferences/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. These cases assert the business
//? logic the sweep can't reach:
//?  [1] happy path — a partial preferences object is allow-list-sanitized,
//?      persisted to the `User.preferences` JSON column, AND reflected in
//?      the response's `result.preferences`.
//?  [2] guard — an unknown/arbitrary key alongside valid boolean keys is
//?      silently dropped from both the response and the persisted row
//?      (the allow-list, not a validation error, is the route's guard here).
//?
//? Integration test: `createRealUser` creates a real Prisma `User` (a genuine
//? ObjectId — the route reads/writes `user.id` against an `@db.ObjectId`
//? field), then `ctx.session.login({ id, email, name })` logs in as that
//? user. No workspace is needed. Teardown is a direct `ctx.prisma.user.delete`.

interface PreferencesOk {
  status: 'success';
  result: { preferences: Record<string, boolean> };
}
interface PreferencesErr {
  status: 'error';
  errorCode: string;
}
type PreferencesResponse = PreferencesOk | PreferencesErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a partial preferences object is persisted and echoed back',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'updateprefs_c1');
      try {
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });

        const res = await ctx.callApi<{ preferences: Record<string, unknown> }, PreferencesResponse>({
          preferences: { notifyOnNewSignIn: false, pushOnAssignment: true },
        });

        ctx.expect.eq(res.status, 'success', 'updatePreferences returns status "success"');
        ctx.expect.ok(
          res.status === 'success'
            && res.result.preferences.notifyOnNewSignIn === false
            && res.result.preferences.pushOnAssignment === true,
          'result.preferences echoes back the submitted boolean fields',
        );

        const row = await ctx.prisma.user.findUnique({ where: { id: user.id }, select: { preferences: true } });
        const stored = row?.preferences as Record<string, unknown> | null | undefined;
        ctx.expect.ok(stored !== null && stored !== undefined, 'User.preferences is persisted');
        if (stored === null || stored === undefined) return;
        ctx.expect.eq(stored.notifyOnNewSignIn, false, 'the persisted row has notifyOnNewSignIn: false');
        ctx.expect.eq(stored.pushOnAssignment, true, 'the persisted row has pushOnAssignment: true');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'an unknown key alongside valid keys is dropped from both the response and the persisted row',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'updateprefs_c2');
      try {
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });

        const res = await ctx.callApi<{ preferences: Record<string, unknown> }, PreferencesResponse>({
          preferences: { notifyOnAssignment: true, someUnknownKey: true },
        });

        ctx.expect.eq(res.status, 'success', 'updatePreferences returns status "success"');
        ctx.expect.ok(
          res.status === 'success' && !('someUnknownKey' in res.result.preferences),
          'the unknown key is absent from result.preferences',
        );

        const row = await ctx.prisma.user.findUnique({ where: { id: user.id }, select: { preferences: true } });
        const stored = row?.preferences as Record<string, unknown> | null | undefined;
        ctx.expect.ok(stored !== null && stored !== undefined, 'User.preferences is persisted');
        if (stored === null || stored === undefined) return;
        ctx.expect.ok(!('someUnknownKey' in stored), 'the unknown key is absent from the persisted row');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
