//? Workspaces — [get-dockerfile] register-flow C: read the persisted draft
//? `.workspaces/Dockerfile` so the review UI can show the last generated/edited draft after
//? a reload without re-running the (slow) AI turn. A direct `_api` read (like generate/build,
//? NOT a Conductor control-op). workspaceSettings-gated. Returns the draft or a typed
//? `dockerfile.noDraft` when none exists yet.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { readDockerfileDraft } from '../../../server/container/dockerfileDraft';
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
  //? R3-b — the draft is per-project; read the active/target project's slot.
  const projectId = await resolveProjectId(functions.db.prisma, workspaceId, data.projectId);
  if (!projectId) return { status: 'success', result: { ok: false, dockerfile: '', error: 'dockerfile.noDraft' } };
  const result = readDockerfileDraft(workspaceId, projectId);
  return { status: 'success', result };
};
