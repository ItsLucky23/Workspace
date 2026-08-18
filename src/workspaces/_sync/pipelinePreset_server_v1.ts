//? Workspaces — [pipeline-apply-preset] apply a pipeline preset (simple/advanced/professional) to the
//? ACTIVE project. `mode: 'fill'` writes the canonical blueprint into the stage fields that are empty
//? right now; `mode: 'switch'` also adds the preset's missing stages and drops the default stages it does
//? not have, moving their tickets back first. Requires editPipeline (OP_CAPABILITY). The client refetches
//? because a switch is structural (stages added/removed/reordered), not a single-row delta.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { projectId: string; preset: string; mode?: 'fill' | 'switch'; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { projectId, preset, mode, clientRequestId } = clientInput;
  if (projectId.trim().length === 0 || preset.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'pipeline-apply-preset', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { projectId }, payload: { preset, mode: mode ?? 'fill' }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
