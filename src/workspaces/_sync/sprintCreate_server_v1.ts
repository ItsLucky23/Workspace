//? Workspaces — [sprint-create] REALTIME write via `_sync`. Creates a sprint, then
//? broadcasts it to the workspace room; every client merges it into the sprint list
//? (dedupe by id, no refetch). Requires the manageSprints capability (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { sprintDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { name: string; active?: boolean; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { name, active, clientRequestId } = clientInput;
  if (name.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'sprint-create', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { name, active: active === true }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', sprint: sprintDelta(res.result) };
};
