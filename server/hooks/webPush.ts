//? Web Push send (FREEDOM_PROGRAM A1). Fans a notification payload out to all of a user's registered
//? `PushSubscription` devices via VAPID. Best-effort + fail-soft: no VAPID env ⇒ silent no-op (push just
//? isn't configured on this deployment); a 404/410 from the push service means the device unsubscribed ⇒ we
//? prune that row. `web-push` is imported LAZILY (optional-peer style) so the server boots without it and a
//? send failure never breaks the notification write it piggybacks on.

import { tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

export interface PushPayload { title: string; body: string; url?: string; tag?: string }

//? web-push is CJS — under the ESM/tsx loader its API lands on `.default`, so type the dynamic import to it
//? (same shape as the lazyEmail optional-peer pattern in notifications.ts).
interface WebPushApi {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void;
  sendNotification: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<{ statusCode: number }>;
}

let cached: WebPushApi | null = null;
async function loadWebPush(): Promise<WebPushApi | null> {
  if (cached) return cached;
  const publicKey = (process.env.WS_VAPID_PUBLIC ?? '').trim();
  const privateKey = (process.env.WS_VAPID_PRIVATE ?? '').trim();
  const subject = (process.env.WS_VAPID_SUBJECT ?? '').trim() || 'mailto:admin@example.com';
  if (publicKey.length === 0 || privateKey.length === 0) return null;
  const [err, mod] = await tryCatch(() => import('web-push') as Promise<{ default: WebPushApi }>);
  if (err || !mod) return null;
  const lib = mod.default;
  const [setErr] = await tryCatch(() => { lib.setVapidDetails(subject, publicKey, privateKey); return true; });
  if (setErr) return null;
  cached = lib;
  return lib;
}

//? Send a push to every device of `userId`. Prunes dead subscriptions. Never throws.
export async function sendWebPush(prisma: PrismaClient, userId: string, payload: PushPayload): Promise<void> {
  const lib = await loadWebPush();
  if (!lib) return;
  const [, subs] = await tryCatch(() => prisma.pushSubscription.findMany({ where: { userId } }));
  if (!subs || subs.length === 0) return;
  const body = JSON.stringify({ title: payload.title, body: payload.body, ...(payload.url ? { url: payload.url } : {}), ...(payload.tag ? { tag: payload.tag } : {}) });
  for (const sub of subs) {
    const keys = sub.keys;
    if (keys === null || typeof keys !== 'object' || Array.isArray(keys)) continue;
    const p256dh = (keys as Record<string, unknown>).p256dh;
    const auth = (keys as Record<string, unknown>).auth;
    if (typeof p256dh !== 'string' || typeof auth !== 'string') continue;
    const [err] = await tryCatch(() => lib.sendNotification({ endpoint: sub.endpoint, keys: { p256dh, auth } }, body));
    if (err) {
      //? 404/410 = the browser dropped the subscription → prune it so we stop trying.
      const msg = err.message;
      if (msg.includes('410') || msg.includes('404')) await prisma.pushSubscription.deleteMany({ where: { id: sub.id } }).catch(() => null);
    }
  }
}
