//? X3 — list the caller's Personal Access Tokens for a workspace (prefix + name + scopes; NEVER the raw token
//? or hash). Membership-gated. Backs the settings "API tokens" panel (issue/list/revoke).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

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
  //? Only the CALLER's own tokens; never expose the hash.
  const rows = await functions.db.prisma.personalAccessToken.findMany({
    where: { workspaceId, userId: user.id, revoked: false },
    select: { id: true, name: true, tokenPrefix: true, scopes: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return { status: 'success', result: { tokens: rows.map((r) => ({ id: r.id, name: r.name, prefix: r.tokenPrefix, scopes: r.scopes, createdAt: r.createdAt.getTime() })) } };
};
