//? Workspaces — [save-dockerfile] register-flow C: persist the user's edited draft
//? `.workspaces/Dockerfile` back to the file `buildProjectImage` reads from disk (07b §1.2:
//? "the file is Admin-editable between generate and build"). The typed route validates/RBAC-gates;
//? the Conductor serializes the filesystem write. Re-validates the
//? first `FROM` extends the L1 base before writing, so an edited draft cannot smuggle an
//? arbitrary base. Committing the draft into the linked repo is a later slice.

import { createHash } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { resolveProjectId } from '../../../server/orchestrator/projectResolve';
import { hasCapability, CAP } from '../../../server/control/rbac';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; dockerfile: string; projectId?: string; clientRequestId?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const workspaceId = data.workspaceId;
  if (!workspaceId || typeof data.dockerfile !== 'string') return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workspaceSettings);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  //? R3-b — write to the active/target project's own draft slot.
  const projectId = await resolveProjectId(functions.db.prisma, workspaceId, data.projectId);
  if (!projectId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const suppliedRequestId = data.clientRequestId?.trim();
  const requestId = suppliedRequestId !== undefined && suppliedRequestId.length > 0 ? suppliedRequestId : createHash('sha256').update(projectId).update('\0').update(data.dockerfile).digest('hex');
  const applied = await enqueueInternalAction({
    workspaceId,
    op: 'dockerfile-save',
    target: { projectId },
    payload: { dockerfile: data.dockerfile },
    userId: user.id,
    clientRequestId: `dockerfile-save:${requestId}`,
  });
  const result = applied.result !== null && typeof applied.result === 'object' && 'ok' in applied.result && typeof applied.result.ok === 'boolean'
    ? { ok: applied.result.ok, ...('error' in applied.result && typeof applied.result.error === 'string' ? { error: applied.result.error } : {}) }
    : { ok: false, error: 'dockerfile.saveFailed' };
  return { status: 'success', result };
};
