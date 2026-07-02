//? Workspaces — [add-comment] REALTIME write via `_sync`. Appends a user comment to a
//? ticket, then broadcasts the created note to the workspace room; every client merges
//? it into the ticket's comment thread (dedupe by id, no refetch). The note delta maps
//? the row's ObjectId ticketId → the DEV-key this route operated on.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { noteDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { ticketId: string; body: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { ticketId, body, clientRequestId } = clientInput;
  if (body.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'add-comment', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { ticketId }, payload: { body }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', note: noteDelta(res.result, ticketId) };
};
