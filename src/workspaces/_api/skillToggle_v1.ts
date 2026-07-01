//? Workspaces — [skill-toggle] typed per-action write route (Fase-0 split). Enables/
//? disables an InfoSource (skill). See quickAdd_v1 for the pattern.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueControlAction } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; sourceId: string; on: boolean; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, sourceId, on, clientRequestId } = data;
  if (!workspaceId || !sourceId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.editPipeline);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const { signalSeq } = await enqueueControlAction({ workspaceId, op: 'skill-toggle', target: { sourceId }, payload: { on }, userId: user.id, clientRequestId });
  return { status: 'success', result: { accepted: true, signalSeq } };
};
