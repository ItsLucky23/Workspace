//? Workspaces — [accept-suggestion] typed per-action write route (Fase-0 split).
//? Marks an AI suggestion accepted. Login-only own-resource op (no capability — any
//? member may action a suggestion shown to them). See quickAdd_v1 for the pattern.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { enqueueControlAction } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; suggestionId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, suggestionId, clientRequestId } = data;
  if (!workspaceId || !suggestionId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const { signalSeq } = await enqueueControlAction({ workspaceId, op: 'accept-suggestion', target: { suggestionId }, payload: {}, userId: user.id, clientRequestId });
  return { status: 'success', result: { accepted: true, signalSeq } };
};
