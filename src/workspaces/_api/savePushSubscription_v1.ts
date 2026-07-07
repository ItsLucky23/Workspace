//? Store (or remove) a browser Web Push subscription for the current user (FREEDOM_PROGRAM A1). The client
//? subscribes via the service worker + `pushManager.subscribe(...)` and POSTs the resulting endpoint + keys
//? here; the server upserts a `PushSubscription` (framework-global, keyed on the user + the unique endpoint).
//? `remove:true` deletes it (unsubscribe). The owner is the AUTHENTICATED user — never a client-supplied id.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { endpoint?: string; keys?: { p256dh: string; auth: string }; fullBodyOptIn?: boolean; remove?: boolean };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const endpoint = (data.endpoint ?? '').trim();
  if (endpoint.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  const prisma = functions.db.prisma;

  if (data.remove === true) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } }).catch(() => null);
    return { status: 'success', result: { removed: true } };
  }

  const keys = data.keys;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return { status: 'error', errorCode: 'api.invalidRequest' };
  const fullBodyOptIn = data.fullBodyOptIn === true;
  const saved = await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: user.id, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, fullBodyOptIn },
    update: { userId: user.id, keys: { p256dh: keys.p256dh, auth: keys.auth }, fullBodyOptIn, lastUsedAt: new Date() },
  }).catch(() => null);

  if (!saved) return { status: 'error', errorCode: 'common.500' };
  return { status: 'success', result: { subscribed: true } };
};
