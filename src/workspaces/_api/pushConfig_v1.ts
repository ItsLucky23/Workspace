//? Deliver the Web Push VAPID PUBLIC key to the browser (FREEDOM_PROGRAM A1) so it can subscribe. The public
//? key is safe to expose (that's its purpose); the private key never leaves the server. `enabled` tells the
//? client whether push is configured on this deployment (both keys present) so the UI can hide the toggle.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 60;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout;
  functions: Functions;
}

// eslint-disable-next-line @typescript-eslint/require-await
export const main = async (_params: ApiParams): Promise<ApiResponse> => {
  void _params;
  const publicKey = (process.env.WS_VAPID_PUBLIC ?? '').trim();
  const enabled = publicKey.length > 0 && (process.env.WS_VAPID_PRIVATE ?? '').trim().length > 0;
  return { status: 'success', result: { vapidPublicKey: publicKey, enabled } };
};
