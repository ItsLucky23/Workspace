//? Workspaces — [generate-dockerfile] register-flow C: AI-author a project's
//? `.workspaces/Dockerfile` from the linked repo's manifests. The slow AI turn stays outside the
//? writer lease; a short typed CAS completion persists the draft through the Conductor.
//? workspaceSettings-gated + heavily rate-limited. Returns the generated draft (validated to extend
//? the L1 base) for the review UI; the L2 build + repo commit are later slices.

import { createHash } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { generateDockerfile } from '../../../server/ai/dockerfileGen';
import { hasCapability, CAP } from '../../../server/control/rbac';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';
import { dockerfileEntityKey, readEntityVersion } from '../../../server/orchestrator/entityVersion';
import { resolveProjectId } from '../../../server/orchestrator/projectResolve';

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
  //? Capture the entity version before the slow provider turn; only the typed completion may write.
  const projectId = await resolveProjectId(functions.db.prisma, workspaceId, data.projectId);
  if (!projectId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const expectedVersion = await readEntityVersion(functions.db.prisma, workspaceId, dockerfileEntityKey(projectId));
  const result = await generateDockerfile(functions.db.prisma, workspaceId, projectId);
  if (!result.ok) return { status: 'success', result };
  const digest = createHash('sha256').update(result.dockerfile).digest('hex');
  const saved = await enqueueInternalAction({
    workspaceId,
    op: 'dockerfile-save',
    target: { projectId, expectedVersion },
    payload: { dockerfile: result.dockerfile },
    userId: user.id,
    clientRequestId: `dockerfile-generate:${projectId}:${digest}`,
  });
  if (saved.result !== null && typeof saved.result === 'object' && 'ok' in saved.result && saved.result.ok === false) {
    const error = 'error' in saved.result && typeof saved.result.error === 'string' ? saved.result.error : 'dockerfile.saveFailed';
    return { status: 'success', result: { ok: false, dockerfile: result.dockerfile, error } };
  }
  return { status: 'success', result };
};
