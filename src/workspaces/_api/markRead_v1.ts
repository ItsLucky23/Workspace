//? Workspaces — [mark-read] typed per-action write route (Fase-0 split). Marks one
//? notification read, or ALL of the caller's notifications when `all` is true. This
//? is a login-only own-resource op (no capability needed — the Conductor scopes the
//? update to `userId`). See quickAdd_v1 for the base pattern.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { enqueueControlAction, isControlActionFailure } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; notificationId?: string; all?: boolean; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, notificationId, all, clientRequestId } = data;
  if (!workspaceId || (all !== true && !notificationId)) return { status: 'error', errorCode: 'api.invalidRequest' };
  const target = all === true ? { all: true } : { notificationId: notificationId ?? '' };
  const [enqueueError, enqueued] = await functions.tryCatch.tryCatch(() => enqueueControlAction({
    workspaceId, op: 'mark-read', target, payload: {}, userId: user.id, clientRequestId,
  }));
  if (enqueueError || !enqueued || isControlActionFailure(enqueued.result)) {
    return { status: 'error', errorCode: 'api.invalidRequest' };
  }
  return { status: 'success', result: { accepted: true, signalSeq: enqueued.signalSeq } };
};
