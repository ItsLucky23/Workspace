//? R1 — export a workspace's user-authored styles as a portable JSON set (copy/apply to another workspace).
//? Membership-gated.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { exportStyleSet } from '../../../server/content/styles';

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
  const styles = await exportStyleSet(functions.db.prisma, workspaceId);
  return { status: 'success', result: { styles: JSON.stringify(styles) } };
};
