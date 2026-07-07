//? X3 — revoke a Personal Access Token (the owner only). A revoked PAT resolves to null → all its API calls
//? 401 immediately. The row is kept (revoked flag) as an audit record.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { patId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { patId } = data;
  if (!patId) return { status: 'error', errorCode: 'api.invalidRequest' };
  //? Only the token's OWNER may revoke it (userId-scoped update).
  const res = await functions.db.prisma.personalAccessToken.updateMany({ where: { id: patId, userId: user.id }, data: { revoked: true } });
  return res.count > 0 ? { status: 'success', result: { revoked: true } } : { status: 'error', errorCode: 'pat.notFound' };
};
