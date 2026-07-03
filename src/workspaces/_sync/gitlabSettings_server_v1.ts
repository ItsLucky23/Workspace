//? Workspaces — [gitlab-settings] REALTIME write via `_sync`. Saves the workspace's
//? GitLab base URL + (app-encrypted) token. The token is never read back and the URL
//? is not part of the tenant snapshot, so there is no client delta to merge — this is
//? a write-only op (goes through the single-writer Conductor). Requires workspaceSettings.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { baseUrl: string; token?: string; forgeType?: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { baseUrl, token, forgeType, clientRequestId } = clientInput;
  const res = await dispatchControlSync({
    op: 'gitlab-settings', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { baseUrl, ...(token ? { token } : {}), ...(forgeType ? { forgeType } : {}) }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
