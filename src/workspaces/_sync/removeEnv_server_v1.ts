//? Workspaces — [remove-env] REALTIME write via `_sync`. Deletes an env var, then
//? broadcasts the removed id to the workspace room; every client drops it (no refetch).
//? The route echoes the id it deleted — a successful dispatch means the row is gone.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { envId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const res = await dispatchControlSync({
    op: 'remove-env', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { envId: clientInput.envId }, clientRequestId: clientInput.clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', removedEnvId: clientInput.envId };
};
