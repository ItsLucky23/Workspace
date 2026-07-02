//? Workspaces — [quick-add] REALTIME write via `_sync` (milestone 1). Runs ONCE on
//? the server: validate + RBAC + enqueue on the serial Conductor + broadcast the
//? created ticket to the whole workspace room. Every client in the room (INCLUDING
//? the sender) receives `serverOutput` via `upsertSyncEventCallback('workspaces/quickAdd')`
//? and merges the new ticket into local state — no refetch (the user's realtime ask).
//?
//? The room code IS the workspaceId (the client joins room = workspaceId). Membership
//? is enforced by the sync layer (`requireRoomMembership`) and re-checked by RBAC.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueControlAction } from '../../../server/orchestrator/conductor';
import { ticketDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { title: string; sprintId?: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const workspaceId = roomCode;
  const { title, sprintId, clientRequestId } = clientInput;
  if (!workspaceId || title.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };

  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };

  const { result } = await enqueueControlAction({
    workspaceId, op: 'quick-add', target: {},
    payload: { title, ...(sprintId ? { sprintId } : {}) },
    userId: user.id, clientRequestId,
  });
  return { status: 'success', ticket: ticketDelta(result) };
};
