//? Workspaces — [rename-workspace] REALTIME write via `_sync`. Renames the workspace,
//? then broadcasts the new name to the room; every client updates the workspace in the
//? switcher + header (no refetch). Requires workspaceSettings (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { name: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { name, clientRequestId } = clientInput;
  if (name.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'rename-workspace', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { name }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', workspaceId: roomCode, name };
};
