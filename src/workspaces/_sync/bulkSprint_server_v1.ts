//? Workspaces — [bulk-sprint] REALTIME write via `_sync`. Moves ticket(s) to a sprint,
//? then broadcasts the affected tickets to the workspace room (client upserts, no
//? refetch). Requires the manageSprints capability (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { ticketListDelta } from '../../../server/read/mappers';

export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { ticketIds: string[]; sprintId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const res = await dispatchControlSync({
    op: 'bulk-sprint', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { ticketIds: clientInput.ticketIds }, payload: { sprintId: clientInput.sprintId }, clientRequestId: clientInput.clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', tickets: ticketListDelta(res.result) };
};
