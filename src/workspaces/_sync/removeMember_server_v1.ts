//? Workspaces — [remove-member] REALTIME write via `_sync`. Removes a member, then
//? broadcasts the removed id to the workspace room; every client drops them (no
//? refetch). Requires manageMembers.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { memberId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const res = await dispatchControlSync({
    op: 'remove-member', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { memberId: clientInput.memberId }, clientRequestId: clientInput.clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', removedMemberId: clientInput.memberId };
};
