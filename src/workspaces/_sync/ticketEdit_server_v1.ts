//? Workspaces — [ticket-edit] REALTIME write via `_sync`. Edits a ticket's title /
//? description / labels, then broadcasts the updated ticket to the workspace room;
//? every client upserts by id (no refetch). Only the fields the caller actually sent
//? are forwarded (a plain `if` so `description: ''` can clear it).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { ticketListDelta } from '../../../server/read/mappers';

export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { ticketId: string; title?: string; description?: string; labels?: string[]; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { ticketId, title, description, labels, clientRequestId } = clientInput;
  if (title?.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const payload: { title?: string; description?: string; labels?: string[] } = {};
  if (title !== undefined) payload.title = title;
  if (description !== undefined) payload.description = description;
  if (labels !== undefined) payload.labels = labels;

  const res = await dispatchControlSync({
    op: 'ticket-edit', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { ticketId }, payload, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', tickets: ticketListDelta(res.result) };
};
