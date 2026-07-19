//? Workspaces — [ticket-edit] REALTIME write via `_sync`. Edits a ticket's title /
//? description / labels, then broadcasts the updated ticket to the workspace room;
//? every client upserts by id (no refetch). Only the fields the caller actually sent
//? are forwarded (a plain `if` so `description: ''` can clear it).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { ticketListDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { ticketId: string; title?: string; description?: string; labels?: string[]; priority?: string; /*? null = the project root unit, distinct from omitting the key */ serviceId?: string | null; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { ticketId, title, description, labels, priority, serviceId, clientRequestId } = clientInput;
  if (title?.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const payload: { title?: string; description?: string; labels?: string[]; priority?: string; serviceId?: string | null } = {};
  if (title !== undefined) payload.title = title;
  if (description !== undefined) payload.description = description;
  if (labels !== undefined) payload.labels = labels;
  if (priority !== undefined) payload.priority = priority;
  //? Presence decides, not truthiness: `null` is a real value here ("move this ticket back to the root").
  if (serviceId !== undefined) payload.serviceId = serviceId;

  const res = await dispatchControlSync({
    op: 'ticket-edit', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { ticketId }, payload, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', tickets: ticketListDelta(res.result) };
};
