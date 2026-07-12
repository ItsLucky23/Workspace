//? Client Web Push subscribe/unsubscribe (FREEDOM_PROGRAM A1). Fetches the VAPID public key, asks the browser
//? to subscribe via the (already-registered) service worker, and stores the subscription server-side. Returns
//? a typed status so the settings toggle can show the right feedback. Fail-soft everywhere.

import { apiRequest, tryCatch } from '@luckystack/core/client';

export type PushResult = 'ok' | 'denied' | 'unsupported' | 'unconfigured' | 'error';

//? VAPID public key (base64url) → the Uint8Array applicationServerKey the Push API expects.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replaceAll('-', '+').replaceAll('_', '/');
  const raw = globalThis.atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.codePointAt(i) ?? 0;
  return out;
}

export async function enablePush(): Promise<PushResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in globalThis) || !('Notification' in globalThis)) return 'unsupported';
  const cfg = await apiRequest({ name: 'workspaces/pushConfig', version: 'v1', data: {} });
  if (cfg.status !== 'success' || !cfg.result.enabled || typeof cfg.result.vapidPublicKey !== 'string' || cfg.result.vapidPublicKey.length === 0) return 'unconfigured';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const [subErr, sub] = await tryCatch(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.result.vapidPublicKey) });
  });
  if (subErr || !sub) return 'error';
  const json = sub.toJSON();
  const keys = json.keys;
  if (!json.endpoint || !keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return 'error';
  const res = await apiRequest({ name: 'workspaces/savePushSubscription', version: 'v1', data: { endpoint: json.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } } });
  return res.status === 'success' ? 'ok' : 'error';
}

//? #122 — is there an active browser push subscription right now? Lets the settings toggle reconcile
//? its state on mount (a user who already enabled push should see it ON after a reload).
export async function hasPushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const [, sub] = await tryCatch(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  });
  return Boolean(sub);
}

export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const [, sub] = await tryCatch(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  });
  if (!sub) return;
  const json = sub.toJSON();
  if (json.endpoint) await apiRequest({ name: 'workspaces/savePushSubscription', version: 'v1', data: { endpoint: json.endpoint, remove: true } });
  await tryCatch(() => sub.unsubscribe());
}
