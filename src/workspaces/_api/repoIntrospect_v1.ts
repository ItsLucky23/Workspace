//? Workspaces — [repo-introspect] what the linked repo ACTUALLY contains: runnable package.json
//? scripts, Dockerfiles, compose stacks and the package manager (ADR 0313).
//?
//? The server already read these files — `repoManifests` has fed Dockerfile generation, docs
//? generation and image builds since the register flow existed. It was never shown to the person
//? configuring the workspace, who instead got two blank text inputs for their dev and prod commands
//? and had to remember what their own repo called them. This is the same read, aimed at the user.
//?
//? A direct `_api` read (like getDockerfile), NOT a Conductor control-op: it writes nothing.
//? workspaceSettings-gated, because it discloses repo contents.
//?
//? @docs owner ItsLucky23

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { repoIntrospect } from '../../../server/git/repoStore';
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
  const workspaceId = data.workspaceId;
  if (!workspaceId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workspaceSettings);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };

  //? Per PROJECT, like every other repo read: a multi-project workspace must introspect the repo the
  //? user is looking at, not project #1.
  const projectId = await resolveProjectId(functions.db.prisma, workspaceId, data.projectId);
  //? No project (or no repo) is the NORMAL state on a fresh workspace, not an error — the UI renders
  //? "link a repository first" from `linked: false` rather than an error toast.
  if (!projectId) return { status: 'success', result: { linked: false, packageManager: 'unknown', scripts: [], dockerfiles: [], composeFiles: [], units: [], truncated: false } };

  const found = await repoIntrospect(workspaceId, projectId);
  const linked = found.scripts.length > 0 || found.dockerfiles.length > 0 || found.composeFiles.length > 0 || found.units.length > 0;
  return { status: 'success', result: { linked, ...found } };
};
