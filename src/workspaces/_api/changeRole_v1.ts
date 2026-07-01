//? Workspaces — [change-role] typed per-action write route (Fase-0 split). See
//? quickAdd_v1 for the pattern. Sets a member's workspace role.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueControlAction } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; memberId: string; roleKey: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, memberId, roleKey, clientRequestId } = data;
  if (!workspaceId || !memberId || !roleKey) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.manageMembers);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const { signalSeq } = await enqueueControlAction({ workspaceId, op: 'change-role', target: { memberId }, payload: { roleKey }, userId: user.id, clientRequestId });
  return { status: 'success', result: { accepted: true, signalSeq } };
};
