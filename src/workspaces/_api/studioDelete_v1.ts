//? Workspaces Studio — delete a brief (and its artifacts) or a single artifact. Membership-gated.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { withStudioBriefLock } from '../../../server/studio/briefLock';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; briefId?: string; artifactId?: string; clientRequestId?: string };
  user: SessionLayout;
  functions: Functions;
}

export interface DeleteStudioBriefDependencies { afterBriefCheck?: () => Promise<void> }

export async function deleteStudioBrief(
  prisma: Functions['db']['prisma'],
  workspaceId: string,
  briefId: string,
  dependencies: DeleteStudioBriefDependencies = {},
): Promise<boolean> {
  return withStudioBriefLock(workspaceId, briefId, async () => {
    const brief = await prisma.studioBrief.findFirst({ where: { workspaceId, id: briefId }, select: { id: true } });
    if (!brief) return false;
    await dependencies.afterBriefCheck?.();
    await prisma.studioArtifact.deleteMany({ where: { workspaceId, briefId } });
    const deleted = await prisma.studioBrief.deleteMany({ where: { workspaceId, id: brief.id } });
    return deleted.count === 1;
  });
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, briefId, artifactId } = data;
  if (!workspaceId || (!briefId && !artifactId) || (briefId && artifactId)) return { status: 'error', errorCode: 'api.invalidRequest' };
  if (!(await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets))) return { status: 'error', errorCode: 'auth.forbidden' };

  const targetId = briefId ?? artifactId ?? '';
  const suppliedRequestId = data.clientRequestId?.trim();
  const requestId = suppliedRequestId !== undefined && suppliedRequestId.length > 0 ? suppliedRequestId : targetId;
  const [deleteError, deleted] = await functions.tryCatch.tryCatch(() => enqueueInternalAction({
    workspaceId,
    op: 'studio-delete',
    target: { ...(briefId ? { briefId } : {}), ...(artifactId ? { artifactId } : {}) },
    payload: {},
    userId: user.id,
    clientRequestId: `studio-delete:${requestId}`,
  }));
  const changed = deleted?.result !== null && typeof deleted?.result === 'object' && 'changed' in deleted.result && deleted.result.changed === true;
  if (deleteError || !changed) return { status: 'error', errorCode: 'api.invalidRequest' };
  return { status: 'success', result: { ok: true } };
};
