import { createHash } from 'node:crypto';
import { getSessionAdapter } from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout;
  functions: Functions;
}

//? Opaque, non-reversible handle for a session token. The raw token is the
//? HttpOnly-cookie credential, so it must NEVER reach page JS — we return this
//? hash instead and `revokeSession_v1` resolves it back to the real token by
//? re-hashing the user's own active tokens server-side.
export const sessionHandle = (token: string): string =>
  createHash('sha256').update(token).digest('hex').slice(0, 16);

export const main = async ({ user }: ApiParams): Promise<ApiResponse> => {
  //? Route through the registered SessionAdapter (NOT raw Redis) so this works
  //? under any backend the framework supports — Redis / DynamoDB / Postgres /
  //? JWT-stateless. `listActive`/`getRaw`/`ttl` are the adapter's documented
  //? per-user enumeration surface.
  const adapter = getSessionAdapter();
  const tokens = await adapter.listActive(user.id).catch(() => null);
  if (tokens === null) {
    return { status: 'error', errorCode: 'common.500' };
  }

  const sessions = await Promise.all(tokens.map(async (token) => {
    const raw = await adapter.getRaw(token);
    if (!raw) return null;
    const ttl = await adapter.ttl(token);
    return {
      handle: sessionHandle(token),
      expiresInSeconds: typeof ttl === 'number' && ttl >= 0 ? ttl : null,
      isCurrent: token === user.token,
    };
  }));

  return {
    status: 'success',
    result: { sessions: sessions.filter((s) => s !== null) },
  };
};
