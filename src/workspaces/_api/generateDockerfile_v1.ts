//? Workspaces — [generate-dockerfile] register-flow C: AI-author a project's
//? `.workspaces/Dockerfile` from the linked repo's manifests. A direct `_api` op (NOT a
//? Conductor control-op) because the AI turn is slow (~1-2min) and must not block the
//? serial writer. workspaceSettings-gated + heavily rate-limited. Returns the generated
//? draft (validated to extend the L1 base) for the review UI; the L2 build + repo commit
//? are later slices.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { generateDockerfile } from '../../../server/ai/dockerfileGen';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 6;
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
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workspaceSettings);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const result = await generateDockerfile(functions.db.prisma, workspaceId);
  return { status: 'success', result };
};
