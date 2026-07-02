//? Workspaces — [save-stage-config] REALTIME write via `_sync`. Persists the full
//? editable per-stage config, then broadcasts the updated stage to the room; every
//? client upserts it by id (no refetch). The Conductor reads the flat fields + coerces
//? the composites; `stageConfigDelta` maps the row back with the SAME shape the
//? snapshot emits (shared `toStageConfig`). Requires editPipeline (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import type { PipelineStageCfg } from '../_data/types';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { stageConfigDelta } from '../../../server/read/workspaceSnapshot';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { stageId: string; cfg: PipelineStageCfg; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { stageId, cfg, clientRequestId } = clientInput;
  if (!stageId) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'save-stage-config', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { stageId }, payload: { ...cfg }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', stageConfig: stageConfigDelta(res.result) };
};
