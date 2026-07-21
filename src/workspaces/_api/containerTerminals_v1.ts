//? Workspaces — [container-terminals] list the workspace's RUNNING ticket containers so
//? the Terminals page can render one live container shell per active ticket. Read-only,
//? workTickets-gated. The actual PTY is opened over the ws-term socket relay (docker exec
//? into the container, server/hooks/workspacesTerminal.ts); this route just enumerates
//? which containers exist. [] when Docker is down — the page falls back to its empty state.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { listWorkspaceContainers } from '../../../server/container/runtime';
import { CAP, hasCapability } from '../../../server/control/rbac';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const workspaceId = data.workspaceId;
  if (!workspaceId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const containers = await listWorkspaceContainers(workspaceId);
  return { status: 'success', result: { containers } };
};
