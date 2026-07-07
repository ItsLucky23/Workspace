//? Web Push send (FREEDOM_PROGRAM A1). Fans a notification payload out to all of a user's registered
//? `PushSubscription` devices via VAPID. Best-effort + fail-soft: no VAPID env ⇒ silent no-op (push just
//? isn't configured on this deployment); a 404/410 from the push service means the device unsubscribed ⇒ we
//? prune that row. `web-push` is imported LAZILY (optional-peer style) so the server boots without it and a
//? send failure never breaks the notification write it piggybacks on.

import { tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

export interface PushPayload { title: string; body: string; url?: string; tag?: string }

//? A3 — per-type push opt-out. Each category maps to a User.preferences boolean (default ON = opt-out); a push
//? is suppressed only when the user explicitly set it to false.
export type PushCategory = 'assignment' | 'automation' | 'aiSuggestion';
const PREF_KEY: Record<PushCategory, string> = { assignment: 'pushOnAssignment', automation: 'pushOnAutomation', aiSuggestion: 'pushOnAiSuggestion' };

//? Pure gate (default ON = opt-out): a push is allowed unless the user's preferences set this category false.
//? Exported for tests.
export function pushCategoryAllowed(prefs: unknown, category?: PushCategory): boolean {
  if (!category) return true;
  if (prefs === null || typeof prefs !== 'object' || Array.isArray(prefs)) return true;
  return (prefs as Record<string, unknown>)[PREF_KEY[category]] !== false;
}

async function categoryAllowed(prisma: PrismaClient, userId: string, category?: PushCategory): Promise<boolean> {
  if (!category) return true;
  const [, user] = await tryCatch(() => prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } }));
  return pushCategoryAllowed(user?.preferences, category);
}

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

//? A2 — push the same payload to a set of users (a notification fan-out). Best-effort per user; never throws.
export async function sendWebPushMany(prisma: PrismaClient, userIds: string[], payload: PushPayload, category?: PushCategory): Promise<void> {
  for (const userId of userIds) await sendWebPush(prisma, userId, payload, category);
}

//? Send a push to every device of `userId` (A3: unless the user opted out of this category). Prunes dead
//? subscriptions. Never throws.
export async function sendWebPush(prisma: PrismaClient, userId: string, payload: PushPayload, category?: PushCategory): Promise<void> {
  const lib = await loadWebPush();
  if (!lib) return;
  if (!(await categoryAllowed(prisma, userId, category))) return;
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
