//? Workspaces — [save-env] REALTIME write via `_sync`. Upserts an env var, then
//? broadcasts the row to the workspace room; every client upserts it by id (no
//? refetch). Requires workspaceSettings (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { envDelta } from '../../../server/read/mappers';

export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { key: string; value: string; secret: boolean; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { key, value, secret, clientRequestId } = clientInput;
  if (key.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'save-env', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { key, value, secret }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', envVar: envDelta(res.result) };
};
