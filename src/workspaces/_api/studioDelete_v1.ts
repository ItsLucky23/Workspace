//? Workspaces Studio — delete a brief (and its artifacts) or a single artifact. Membership-gated.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { withStudioBriefLock } from '../../../server/studio/briefLock';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueWorkspaceRouteWrite } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; briefId?: string; artifactId?: string };
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

  const [deleteError, deleted] = await functions.tryCatch.tryCatch(() => enqueueWorkspaceRouteWrite(
    workspaceId,
    { kind: 'studio.delete', userId: user.id },
    async () => {
      if (artifactId) {
        const result = await functions.db.prisma.studioArtifact.deleteMany({ where: { workspaceId, id: artifactId } });
        return result.count === 1;
      }
      return briefId ? deleteStudioBrief(functions.db.prisma, workspaceId, briefId) : false;
    },
  ));
  if (deleteError || deleted !== true) return { status: 'error', errorCode: 'api.invalidRequest' };
  return { status: 'success', result: { ok: true } };
};
