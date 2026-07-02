//? Workspaces — [build-project-image] register-flow C: build the AI-authored draft
//? `.workspaces/Dockerfile` into the L2 per-project image (content-hash tagged) and point
//? Project.baseImageRef at it. A direct `_api` op (NOT a Conductor control-op) — the
//? `docker build` is slow and must not block the serial writer. workspaceSettings-gated
//? (Admin, Q-CT-DOCKERFILE-TRUST), local-daemon-only. The draft is re-validated to extend
//? the L1 base before building.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { buildProjectImage } from '../../../server/container/imageBuild';
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
  const result = await buildProjectImage(functions.db.prisma, workspaceId);
  return { status: 'success', result };
};
