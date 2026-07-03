//? Workspaces — [agent controls] REALTIME control-op via `_sync` (C2). One route for the five
//? engine controls: pause/resume/kill a ticket's autonomous turn, and pause-all/resume-all for
//? the workspace. Each dispatches through the single-writer Conductor (RBAC-gated per op in
//? OP_CAPABILITY). Ticket-scoped ops broadcast a ticket delta from the Conductor, so the board
//? updates live; pause-all/resume-all set a workspace flag (reflected on next load).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { op: string; ticketKey?: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, ticketKey, clientRequestId } = clientInput;
  //? Narrow to the allowed ControlOps (no cast) — anything else is rejected before dispatch.
  if (op !== 'pause' && op !== 'resume' && op !== 'kill' && op !== 'pause-all' && op !== 'resume-all') {
    return { status: 'error', errorCode: 'sync.invalidRequest' };
  }
  const res = await dispatchControlSync({
    op, roomCode, userId: user.id, prisma: functions.db.prisma,
    ...(ticketKey ? { target: { ticketKey } } : {}), payload: {}, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
