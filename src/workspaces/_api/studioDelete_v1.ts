//? Workspaces Studio — delete a brief (and its artifacts) or a single artifact. Membership-gated.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; briefId?: string; artifactId?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, briefId, artifactId } = data;
  if (!workspaceId || (!briefId && !artifactId)) return { status: 'error', errorCode: 'api.invalidRequest' };
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };

  if (artifactId) {
    await functions.db.prisma.studioArtifact.deleteMany({ where: { workspaceId, id: artifactId } });
  } else if (briefId) {
    await functions.db.prisma.studioArtifact.deleteMany({ where: { workspaceId, briefId } });
    await functions.db.prisma.studioBrief.deleteMany({ where: { workspaceId, id: briefId } });
  }
  return { status: 'success', result: { ok: true } };
};
