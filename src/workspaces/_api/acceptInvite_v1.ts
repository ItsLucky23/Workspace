//? Workspaces — [accept-invite] typed per-action route (Fase-0 split). Login-only:
//? the caller may have no active workspace yet (onboarding join), so it carries no
//? workspaceId and runs on the Conductor's login-only path (no signal/tenant); the
//? invite itself names the target workspace.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { enqueueControlAction, isControlActionFailure } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { inviteToken: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { inviteToken, clientRequestId } = data;
  if (!inviteToken) return { status: 'error', errorCode: 'api.invalidRequest' };
  const [enqueueError, enqueued] = await functions.tryCatch.tryCatch(() => enqueueControlAction({
    workspaceId: '', op: 'accept-invite', target: { inviteToken }, payload: {}, userId: user.id, clientRequestId,
  }));
  if (enqueueError || !enqueued || isControlActionFailure(enqueued.result)) {
    return { status: 'error', errorCode: 'api.invalidRequest' };
  }
  return { status: 'success', result: { accepted: true, signalSeq: enqueued.signalSeq } };
};
