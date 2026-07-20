//? Workspaces — [repo-file] read ONE file's content from the active project's linked repo at its baseline
//? branch, for the workspace-level Code destination's preview pane. A direct read `_api` op (reads the bare
//? clone via `git show`, writes nothing authoritative — mirrors readWorktreeFile). Gated on `workTickets`.
//? The path is traversal-guarded + must resolve to a blob in the tree (repoStore.readRepoFileAt); content is
//? bounded (~200KB → { truncated }) and a NUL byte flags a binary blob (returned without content). The
//? project is workspace-validated and the branch comes from the repo's OWN status, never raw client input.
/** @docs owner ItsLucky23 */

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { readRepoFileAt } from '../../../server/git/repoStore';
import { resolveProjectId } from '../../../server/orchestrator/projectResolve';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 60;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; projectId?: string; path: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, projectId: rawProjectId, path } = data;
  if (!workspaceId || !path) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const projectId = await resolveProjectId(functions.db.prisma, workspaceId, rawProjectId);
  if (!projectId) return { status: 'success', result: { ok: false, error: 'repo.notLinked' } };
  const result = await readRepoFileAt(workspaceId, projectId, path);
  return { status: 'success', result };
};
