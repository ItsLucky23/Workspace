//? Workspaces — [revoke-invite] REALTIME write via `_sync`. Revokes a pending invite,
//? then broadcasts the revoked id to the workspace room; every client drops it from
//? the pending list (no refetch). Requires manageMembers.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { inviteId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const res = await dispatchControlSync({
    op: 'revoke-invite', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { inviteId: clientInput.inviteId }, clientRequestId: clientInput.clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', revokedInviteId: clientInput.inviteId };
};
