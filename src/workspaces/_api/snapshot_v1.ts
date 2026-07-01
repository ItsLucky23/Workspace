//? Workspaces — the read snapshot route (server side of `useWorkspaceData()`).
//?
//? Returns the caller's workspaces + the active workspace's tenant-scoped data in
//? the shapes the screens render. Read-only; the server derives the tenant from the
//? validated session + the requested workspaceId (membership-checked in buildSnapshot).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { buildSnapshot } from '../../../server/read/workspaceSnapshot';

export const rateLimit: number | false = 60;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const snapshot = await buildSnapshot(functions.db.prisma, user.id, data.workspaceId);
  return { status: 'success', result: snapshot };
};
