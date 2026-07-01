//? Workspaces — [sprint-create] typed per-action write route (Fase-0 write-path split).
//?
//? Sibling of `quickAdd_v1` — see its header for the pattern. Typed payload → the
//? client's `apiRequest({ name: 'workspaces/sprintCreate', ... })` is fully typed.
//? Validate + RBAC (manage-sprints) + enqueue onto the serial Conductor.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueControlAction } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const validation = 'relaxed' as const;

export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: {
    workspaceId: string;
    name: string;
    active?: boolean;
    clientRequestId: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, name, active, clientRequestId } = data;
  if (!workspaceId || name.trim().length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };

  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.manageSprints);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };

  const { signalSeq } = await enqueueControlAction({
    workspaceId, op: 'sprint-create', target: {},
    payload: { name, active: active === true },
    userId: user.id, clientRequestId,
  });
  return { status: 'success', result: { accepted: true, signalSeq } };
};
