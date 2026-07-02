//? Workspaces — [skill-toggle] REALTIME write via `_sync`. Enables/disables a skill
//? (InfoSource), then broadcasts the source id + new state to the room; every client
//? flips it in place (no refetch). Requires editPipeline (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

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
