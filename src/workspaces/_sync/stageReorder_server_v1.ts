//? Workspaces — [stage-reorder] (R1) persist a new pipeline stage ORDER (drag-reorder survives a refresh).
//? `order` lists the stage keys in their new sequence. The client refetches after. Requires editPipeline.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { order: string[]; projectId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { order, projectId, clientRequestId } = clientInput;
  if (!Array.isArray(order) || order.length === 0 || projectId.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'stage-reorder', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { projectId }, payload: { order }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
