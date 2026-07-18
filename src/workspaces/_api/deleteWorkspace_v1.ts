//? Workspaces — [delete-workspace] typed per-action write route (Fase-0 split).
//? Owner-only; cascade-deletes every tenant row. See quickAdd_v1 for the pattern.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueControlAction, isControlActionFailure } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, clientRequestId } = data;
  if (!workspaceId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.ownerActions);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const [enqueueError, enqueued] = await functions.tryCatch.tryCatch(() => enqueueControlAction({
    workspaceId, op: 'delete-workspace', target: {}, payload: {}, userId: user.id, clientRequestId,
  }));
  if (enqueueError || !enqueued || isControlActionFailure(enqueued.result)) {
    return { status: 'error', errorCode: 'api.invalidRequest' };
  }
  return { status: 'success', result: { accepted: true, signalSeq: enqueued.signalSeq } };
};
