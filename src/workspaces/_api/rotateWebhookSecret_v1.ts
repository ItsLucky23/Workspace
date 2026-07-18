//? Rotates the forge webhook credential. Unlike room-broadcast sync output, this API response
//? goes only to the authenticated initiator so the plaintext can be copied once without leaking.
/** @docs owner ItsLucky23 */

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
}

export type RotateWebhookSecretResult =
  | { ok: true; webhookSecret: string }
  | { ok: false; errorCode: string };

//? Shared with the focused integration test: RBAC → Conductor is the only write path.
export async function rotateWebhookSecretRequest(input: {
  workspaceId: string;
  userId: string;
  clientRequestId: string;
  prisma: Functions['db']['prisma'];
}): Promise<RotateWebhookSecretResult> {
  const { workspaceId, userId, clientRequestId, prisma } = input;
  if (workspaceId.length === 0 || clientRequestId.length === 0) return { ok: false, errorCode: 'api.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'forge-webhook-rotate', roomCode: workspaceId, userId, prisma, payload: {}, clientRequestId,
  });
  if (!res.ok) return { ok: false, errorCode: res.errorCode };
  if (res.result === null || typeof res.result !== 'object' || !('webhookSecret' in res.result) || typeof res.result.webhookSecret !== 'string' || res.result.webhookSecret.length === 0) {
    return { ok: false, errorCode: 'common.500' };
  }
  return { ok: true, webhookSecret: res.result.webhookSecret };
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const result = await rotateWebhookSecretRequest({
    workspaceId: data.workspaceId, userId: user.id, clientRequestId: data.clientRequestId, prisma: functions.db.prisma,
  });
  if (!result.ok) return { status: 'error', errorCode: result.errorCode };
  return { status: 'success', result: { webhookSecret: result.webhookSecret } };
};
