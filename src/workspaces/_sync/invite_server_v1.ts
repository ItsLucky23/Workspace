//? Workspaces — [invite] REALTIME write via `_sync`. Creates a pending invite (and
//? fires the invite email Conductor-side), then broadcasts the invite to the workspace
//? room; every client upserts it by id (no refetch). Requires manageMembers.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { inviteDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { email: string; roleKey: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { email, roleKey, clientRequestId } = clientInput;
  if (email.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'invite', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { email, roleKey }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', invite: inviteDelta(res.result) };
};
