//? Workspaces — [transfer-ownership] REALTIME write via `_sync`. Transfers ownership
//? to another member, then broadcasts the new+previous owner to the workspace room:
//? the new owner becomes `owner`, the previous owner (the caller) becomes `admin`.
//? Every client applies both role changes (no refetch). Requires ownerActions.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { memberId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const res = await dispatchControlSync({
    op: 'transfer-ownership', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { memberId: clientInput.memberId }, clientRequestId: clientInput.clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', newOwnerId: clientInput.memberId, previousOwnerId: user.id };
};
