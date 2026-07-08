//? Workspaces — [stage-delete] (R1) durably REMOVE a pipeline stage. The client refetches the pipeline after.
//? Requires editPipeline (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { stageId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { stageId, clientRequestId } = clientInput;
  if (stageId.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'stage-delete', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { stageId }, payload: {}, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
