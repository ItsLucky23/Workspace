import { AuthProps, SessionLayout } from '../../config';
import { Functions, ApiResponse } from '../_sockets/apiTypes.generated';

export const rateLimit: number | false = 30;

export const auth: AuthProps = {
  login: false,
};

export const httpMethod = 'DELETE' as const;

export interface ApiParams {
  data: Record<string, never>;
  user: SessionLayout | null;
  functions: Functions;
}

export const main = async ({ user, functions }: ApiParams): Promise<ApiResponse> => {
  if (user?.token) {
    await functions.tryCatch.tryCatch(() => functions.session.deleteSession(user.token));
  }
  return {
    status: 'success',
    result: true
  };
};
