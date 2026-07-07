//? Integration test for FREEDOM_PROGRAM A1 — web push. Verifies the savePushSubscription route upserts a
//? PushSubscription for the authenticated user (idempotent on endpoint) and removes it on remove:true, and
//? that sendWebPush is fail-soft (no subscriptions → resolves without throwing). Real Mongo.

import { db, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const saveRoute = await import('../../src/workspaces/_api/savePushSubscription_v1.ts');
const { sendWebPush } = await import('../../server/hooks/webPush.ts');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `push-${String(stamp)}@youcomm.nl`, name: 'PUSH' } });
const endpoint = `https://fcm.example.test/push/${String(stamp)}`;

try {
  const fns = { db: { prisma } } as never;
  const user = { id: owner.id } as never;

  // subscribe
  const r1 = await saveRoute.main({ data: { endpoint, keys: { p256dh: 'p', auth: 'a' } }, user, functions: fns });
  eq(r1.status, 'success', 'subscribe succeeds');
  eq(await prisma.pushSubscription.count({ where: { userId: owner.id } }), 1, 'one subscription stored');

  // idempotent on endpoint (upsert)
  await saveRoute.main({ data: { endpoint, keys: { p256dh: 'p2', auth: 'a2' } }, user, functions: fns });
  eq(await prisma.pushSubscription.count({ where: { userId: owner.id } }), 1, 'same endpoint upserts, not duplicates');

  // missing keys → rejected
  const bad = await saveRoute.main({ data: { endpoint: `${endpoint}-x` }, user, functions: fns });
  eq(bad.status, 'error', 'a subscribe without keys is rejected');

  // sendWebPush is fail-soft when there are no subs for a user
  const other = await prisma.user.create({ data: { email: `push2-${String(stamp)}@youcomm.nl`, name: 'P2' } });
  let threw = false;
  try { await sendWebPush(prisma, other.id, { title: 't', body: 'b' }); } catch { threw = true; }
  assert(!threw, 'sendWebPush never throws (no subscriptions → no-op)');
  await prisma.user.delete({ where: { id: other.id } }).catch(() => undefined);

  // unsubscribe
  const r2 = await saveRoute.main({ data: { endpoint, remove: true }, user, functions: fns });
  eq(r2.status, 'success', 'unsubscribe succeeds');
  eq(await prisma.pushSubscription.count({ where: { userId: owner.id } }), 0, 'the subscription was removed');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  await prisma.pushSubscription.deleteMany({ where: { userId: owner.id } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/pushSubscription.test.mts');
