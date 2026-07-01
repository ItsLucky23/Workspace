import { deleteSession, getSessionAdapter } from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { sessionHandle } from './listSessions_v1';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: [],
};

export interface ApiParams {
  //? `handle` is the opaque session id returned by `listSessions_v1` (a hash of
  //? the real token) — the raw token never leaves the server.
  data: { handle: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const targetHandle = data.handle;
  if (!targetHandle || targetHandle === sessionHandle(user.token)) {
    // Refuse to revoke the current session — the user must log out instead.
    return { status: 'error', errorCode: 'session.invalid' };
  }

  //? Route through the registered SessionAdapter (NOT raw Redis) so revoke works
  //? under any session backend. Resolve the opaque handle back to a real token by
  //? re-hashing THIS user's own active tokens — so a caller can only ever target a
  //? session they own, and the token itself never travels over the wire.
  const adapter = getSessionAdapter();
  const tokens = await adapter.listActive(user.id).catch(() => null);
  if (tokens === null) {
    return { status: 'error', errorCode: 'common.500' };
  }
  const targetToken = tokens.find((token) => sessionHandle(token) === targetHandle);
  if (!targetToken) {
    return { status: 'error', errorCode: 'session.invalid' };
  }

  // Validate the target token still belongs to this user.
  const sessionRaw = await adapter.getRaw(targetToken);
  if (!sessionRaw) {
    return { status: 'error', errorCode: 'session.invalid' };
  }

  const [parseError, parsed] = await functions.tryCatch.tryCatch(
    () => JSON.parse(sessionRaw) as { id?: string },
  );
  if (parseError || parsed?.id !== user.id) {
    return { status: 'error', errorCode: 'auth.forbidden' };
  }

  await deleteSession(targetToken);
  return { status: 'success', result: {} };
};
