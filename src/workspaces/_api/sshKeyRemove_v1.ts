//? Workspaces — [ssh-key-remove] (#76) delete an SSH key from the CALLER'S account. Account-level
//? (login-gated); scoped to the caller's own keys (userId from the session) so a user can never
//? delete another account's key. A direct `_api` write — SSH keys are per-account, not workspace state.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

export const rateLimit: number | false = 12;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { id: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const id = data.id.trim();
  if (id.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  //? Own-key only — the where clause carries userId so another account's id is a no-op, not a delete.
  await functions.db.prisma.sshKey.deleteMany({ where: { id, userId: user.id } });
  return { status: 'success', result: {} };
};
