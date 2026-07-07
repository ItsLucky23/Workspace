//? R3 — export the workspace brand library as a portable JSON kit (download/copy → import elsewhere).
//? Membership-gated. Returns null-shaped `{ kit: null }` when the workspace has no brand library yet.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { exportBrandKit } from '../../../server/studio/brand';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId } = data;
  if (!workspaceId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };
  const kit = await exportBrandKit(functions.db.prisma, workspaceId);
  return { status: 'success', result: { kit: kit ? JSON.stringify(kit) : '' } };
};
