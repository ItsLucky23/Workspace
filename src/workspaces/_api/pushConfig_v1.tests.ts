import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/pushConfig/v1` — delivers the Web Push VAPID public key
//? + an `enabled` flag computed from server env (FREEDOM_PROGRAM A1). Auto-sweep covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't
//? reach: the response shape is well-typed AND internally consistent — `enabled` must never
//? be true while `vapidPublicKey` is empty (that combination would leave the client's
//? subscribe button enabled with nothing to subscribe with).
//?
//? Integration test: `createRealUser` + a direct login (real ObjectId) — no workspace
//? needed, this route reads only server env, not tenant data. Teardown deletes the user.

type PushConfigResponse =
  | { status: 'success'; result: { vapidPublicKey: string; enabled: boolean } }
  | { status: 'error'; errorCode: string };

export const customTests: CustomTestCase[] = [
  {
    name: 'returns a well-typed, internally consistent config',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'pushcfg_c1');
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });
      try {
        const res = await ctx.callApi<Record<string, never>, PushConfigResponse>({});
        ctx.expect.eq(res.status, 'success', 'pushConfig returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.eq(typeof res.result.vapidPublicKey, 'string', 'vapidPublicKey is a string');
        ctx.expect.eq(typeof res.result.enabled, 'boolean', 'enabled is a boolean');
        ctx.expect.ok(
          !res.result.enabled || res.result.vapidPublicKey.length > 0,
          'enabled=true implies a non-empty vapidPublicKey',
        );
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'the config is stable across repeated calls (deterministic given server env)',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'pushcfg_c2');
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });
      try {
        const first = await ctx.callApi<Record<string, never>, PushConfigResponse>({});
        const second = await ctx.callApi<Record<string, never>, PushConfigResponse>({});
        ctx.expect.eq(first.status, 'success', 'first call returns status "success"');
        ctx.expect.eq(second.status, 'success', 'second call returns status "success"');
        if (first.status !== 'success' || second.status !== 'success') return;
        ctx.expect.eq(first.result.vapidPublicKey, second.result.vapidPublicKey, 'vapidPublicKey is stable across calls');
        ctx.expect.eq(first.result.enabled, second.result.enabled, 'enabled is stable across calls');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
