//? Workspaces — [bulk-assign] REALTIME write via `_sync`. (Re)assigns ticket(s), then
//? broadcasts the affected tickets to the workspace room (client upserts, no refetch).
//? The Conductor also notifies the new assignee (unless self-assigned).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { ticketListDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { ticketIds: string[]; assigneeId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const res = await dispatchControlSync({
    op: 'bulk-assign', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { ticketIds: clientInput.ticketIds }, payload: { assigneeId: clientInput.assigneeId }, clientRequestId: clientInput.clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', tickets: ticketListDelta(res.result) };
};
