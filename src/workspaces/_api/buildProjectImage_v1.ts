//? Workspaces — [build-project-image] register-flow C: build the AI-authored draft
//? `.workspaces/Dockerfile` into the L2 per-project image (content-hash tagged) and point
//? Project.baseImageRef at it. Docker build runs outside the lease; only the final baseImageRef
//? completion write enters the Conductor. workspaceSettings-gated
//? (Admin, Q-CT-DOCKERFILE-TRUST), local-daemon-only. The draft is re-validated to extend
//? the L1 base before building.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { buildProjectImage } from '../../../server/container/imageBuild';
import { hasCapability, CAP } from '../../../server/control/rbac';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';

export const rateLimit: number | false = 6;
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
  //? #44 — build the ACTIVE project (falls back to first when omitted), not always project #1.
  const result = await buildProjectImage(functions.db.prisma, workspaceId, data.projectId, {
    persist: async (projectId, tag) => {
      await enqueueInternalAction({
        workspaceId,
        op: 'project-image-complete',
        target: { projectId },
        payload: { tag },
        userId: user.id,
        clientRequestId: `project-image-complete:${projectId}:${tag}`,
      });
    },
  });
  return { status: 'success', result };
};
