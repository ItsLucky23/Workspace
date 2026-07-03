//? Workspaces — [save-dockerfile] register-flow C: persist the user's edited draft
//? `.workspaces/Dockerfile` back to the file `buildProjectImage` reads from disk (07b §1.2:
//? "the file is Admin-editable between generate and build"). A direct `_api` write (like
//? generate/build, NOT a Conductor control-op). workspaceSettings-gated. Re-validates the
//? first `FROM` extends the L1 base before writing, so an edited draft cannot smuggle an
//? arbitrary base. Committing the draft into the linked repo is a later slice.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { saveDockerfileDraft } from '../../../server/container/dockerfileDraft';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; dockerfile: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const workspaceId = data.workspaceId;
  if (!workspaceId || typeof data.dockerfile !== 'string') return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workspaceSettings);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const result = saveDockerfileDraft(workspaceId, data.dockerfile);
  return { status: 'success', result };
};
