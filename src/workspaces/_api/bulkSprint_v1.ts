//? Workspaces — [bulk-sprint] typed per-action write route (Fase-0 split). Moves the
//? given tickets into `sprintId` (empty string = backlog / no sprint). Requires the
//? manage-sprints capability. See quickAdd_v1 for the pattern.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueControlAction } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; ticketIds: string[]; sprintId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, ticketIds, sprintId, clientRequestId } = data;
  if (!workspaceId || ticketIds.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.manageSprints);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const { signalSeq } = await enqueueControlAction({ workspaceId, op: 'bulk-sprint', target: { ticketIds }, payload: { sprintId }, userId: user.id, clientRequestId });
  return { status: 'success', result: { accepted: true, signalSeq } };
};
