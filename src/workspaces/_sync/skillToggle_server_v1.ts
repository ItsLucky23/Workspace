//? Workspaces — [skill-toggle] REALTIME write via `_sync`. Enables/disables a Sources context
//? document (InfoSource), then broadcasts the id + new state; every client flips it in place
//? (no refetch). The frozen op name predates the capability-skill layer's removal. Requires
//? editPipeline (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { sourceId: string; on: boolean; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { sourceId, on, clientRequestId } = clientInput;
  if (!sourceId) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'skill-toggle', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { sourceId }, payload: { on }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', sourceId, on };
};
