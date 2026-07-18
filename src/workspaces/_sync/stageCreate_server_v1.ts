//? Workspaces — [stage-create] (R1) durably ADD a pipeline stage (the editor previously mutated React state only;
//? a refresh discarded structural edits). Broadcasts the created stage; the client upserts it by id. Requires
//? editPipeline (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { stageConfigDelta } from '../../../server/read/workspaceSnapshot';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { key: string; name: string; kind?: string; projectId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { key, name, kind, projectId, clientRequestId } = clientInput;
  if (key.trim().length === 0 || name.trim().length === 0 || projectId.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'stage-create', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { projectId }, payload: { key: key.trim(), name: name.trim(), ...(kind ? { kind } : {}) }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', stageConfig: stageConfigDelta(res.result) };
};
