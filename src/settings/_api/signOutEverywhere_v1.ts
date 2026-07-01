import { revokeUserSessions } from '@luckystack/login';
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 5;
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

export const main = async ({ user }: ApiParams): Promise<ApiResponse> => {
  //? Pass the caller's own token so "sign out everywhere" keeps this session
  //? alive — the intent is "sign out OTHER devices, stay logged in here."
  const revokedCount = await revokeUserSessions(user.id, user.token).catch(() => null);
  if (revokedCount === null) {
    return { status: 'error', errorCode: 'common.500' };
  }
  return { status: 'success', result: { revokedSessions: revokedCount } };
};
