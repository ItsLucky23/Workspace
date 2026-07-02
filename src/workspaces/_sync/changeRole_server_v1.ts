//? Workspaces — [change-role] REALTIME write via `_sync`. Changes a member's role,
//? then broadcasts the member+role to the workspace room; every client updates that
//? member in place (no refetch). Requires manageMembers (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { asRole } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { memberId: string; roleKey: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { memberId, roleKey, clientRequestId } = clientInput;
  if (!memberId || !roleKey) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'change-role', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { memberId }, payload: { roleKey }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', memberId, role: asRole(roleKey) };
};
