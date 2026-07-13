//? Workspaces — [read-worktree-file] read the REAL content of one file from a ticket's container worktree
//? (#35, Track D), so the lightweight in-ticket editor can show git-backed content instead of diff-reconstructed
//? text. A direct `_api` op (docker exec, not a Conductor write — it reads nothing authoritative). Gated on
//? `workTickets`. Path is validated + bounded to /work in the transport (never an arbitrary host path).
//?
//? @docs owner ItsLucky23

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { readWorktreeFile } from '../../../server/container/worktreeFiles';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; ticketKey: string; path: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, ticketKey, path } = data;
  if (!workspaceId || !ticketKey || !path) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const result = await readWorktreeFile(workspaceId, ticketKey, path);
  return { status: 'success', result };
};
