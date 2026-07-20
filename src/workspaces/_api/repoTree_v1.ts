//? Workspaces — [repo-tree] list EVERY file of the active project's linked repo at its baseline branch,
//? so the workspace-level Code destination can show the whole codebase from the nav (today only the
//? per-ticket editor sees repo files). A direct read `_api` op — it reads the bare clone via `git ls-tree`
//? and writes nothing authoritative (mirrors readWorktreeFile's stance). Gated on `workTickets`. The
//? project is workspace-validated (resolveProjectId) and the branch comes from the repo's OWN status,
//? never from raw client input; the listing is capped server-side.
/** @docs owner ItsLucky23 */

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { repoTree } from '../../../server/git/repoStore';
import { resolveProjectId } from '../../../server/orchestrator/projectResolve';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; projectId?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, projectId: rawProjectId } = data;
  if (!workspaceId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const projectId = await resolveProjectId(functions.db.prisma, workspaceId, rawProjectId);
  if (!projectId) return { status: 'success', result: { linked: false } };
  const result = await repoTree(workspaceId, projectId);
  return { status: 'success', result };
};
