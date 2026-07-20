import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/savePushSubscription/v1` — upserts (or removes) a Web
//? Push subscription for the CALLER (FREEDOM_PROGRAM A1). Auto-sweep covers contract/auth/
//? rate-limit/fuzz; these cases assert:
//?  [1] a valid subscribe persists a `PushSubscription` row scoped to the caller's userId.
//?  [2] `remove:true` deletes the caller's subscription for that endpoint.
//?  [3] a missing `endpoint` is rejected with `api.invalidRequest` (no row is created).
//?
//? Integration test: `createRealUser` + a direct login (real ObjectId) — no workspace
//? needed, `PushSubscription` is framework-global, keyed on user + the unique endpoint.
//? Teardown deletes the created row(s) + the user directly.

type SaveResponse =
  | { status: 'success'; result: { subscribed?: boolean; removed?: boolean } }
  | { status: 'error'; errorCode: string };

export const customTests: CustomTestCase[] = [
  {
    name: 'a valid subscribe persists a row scoped to the caller',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'pushsub_c1');
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });
      const endpoint = `https://push.example.test/lstest-pushsub-c1-${String(Date.now())}`;
      try {
        const res = await ctx.callApi<{ endpoint: string; keys: { p256dh: string; auth: string } }, SaveResponse>({
          endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
        });
        ctx.expect.eq(res.status, 'success', 'savePushSubscription returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.subscribed, true, 'result.subscribed is true');
        const row = await ctx.prisma.pushSubscription.findUnique({ where: { endpoint } });
        ctx.expect.ok(row !== null, 'the PushSubscription row was persisted');
        if (!row) return;
        ctx.expect.eq(row.userId, user.id, 'the row is scoped to the caller, not a client-supplied id');
      } finally {
        await ctx.prisma.pushSubscription.deleteMany({ where: { endpoint } });
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: "remove:true deletes the caller's subscription for that endpoint",
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'pushsub_c2');
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });
      const endpoint = `https://push.example.test/lstest-pushsub-c2-${String(Date.now())}`;
      try {
        await ctx.prisma.pushSubscription.create({
          data: { userId: user.id, endpoint, keys: { p256dh: 'p256dh-value', auth: 'auth-value' }, fullBodyOptIn: false },
        });
        const res = await ctx.callApi<{ endpoint: string; remove: boolean }, SaveResponse>({ endpoint, remove: true });
        ctx.expect.eq(res.status, 'success', 'savePushSubscription returns status "success"');
        if (res.status === 'success') ctx.expect.eq(res.result.removed, true, 'result.removed is true');
        const row = await ctx.prisma.pushSubscription.findUnique({ where: { endpoint } });
        ctx.expect.eq(row, null, 'the row no longer exists');
      } finally {
        await ctx.prisma.pushSubscription.deleteMany({ where: { endpoint } });
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'a missing endpoint is rejected and no row is created',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'pushsub_c3');
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });
      try {
        const res = await ctx.callApi<{ keys: { p256dh: string; auth: string } }, SaveResponse>({
          keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
        });
        ctx.expect.eq(res.status, 'error', 'a missing endpoint is rejected');
        if (res.status === 'error') ctx.expect.eq(res.errorCode, 'api.invalidRequest', 'errorCode is api.invalidRequest');
        const count = await ctx.prisma.pushSubscription.count({ where: { userId: user.id } });
        ctx.expect.eq(count, 0, 'no PushSubscription row was created');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
