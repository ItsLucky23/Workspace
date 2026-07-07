//? X3 — issue a Personal Access Token for the public API. Membership-gated (the caller must be a member of the
//? workspace the PAT is scoped to). The RAW token is returned ONCE here + never stored (only its hash is).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { generateToken } from '../../../server/auth/pat';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

const ALLOWED_SCOPES = new Set(['tickets:write', 'content:write']);

export interface ApiParams {
  data: { workspaceId: string; name?: string; scopes?: string[] };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId } = data;
  if (!workspaceId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };
  const scopes = (Array.isArray(data.scopes) ? data.scopes : []).filter((s): s is string => typeof s === 'string' && ALLOWED_SCOPES.has(s));
  if (scopes.length === 0) return { status: 'error', errorCode: 'pat.noScopes' };
  const token = generateToken();
  const created = await functions.db.prisma.personalAccessToken.create({
    data: { userId: user.id, workspaceId, name: (data.name ?? 'API token').trim() || 'API token', tokenHash: token.hash, tokenPrefix: token.prefix, scopes },
  }).catch(() => null);
  if (!created) return { status: 'error', errorCode: 'common.500' };
  //? The RAW token is shown ONCE — the client must store it now; the server keeps only the hash.
  return { status: 'success', result: { id: created.id, token: token.raw, prefix: token.prefix, scopes } };
};
