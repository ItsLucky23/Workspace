//? Workspaces — [sprint-edit] REALTIME write via `_sync`. Activates / renames / (re)dates a sprint,
//? then broadcasts it to the workspace room; every client merges it by id (#1). Requires the
//? manageSprints capability (OP_CAPABILITY, same as sprint-create).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { sprintDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { sprintId: string; name?: string; active?: boolean; startAt?: string; endAt?: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { sprintId, name, active, startAt, endAt, clientRequestId } = clientInput;
  if (sprintId.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'sprint-edit', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { sprintId },
    payload: {
      ...(name === undefined ? {} : { name }),
      ...(active === undefined ? {} : { active }),
      ...(startAt === undefined ? {} : { startAt }),
      ...(endAt === undefined ? {} : { endAt }),
    },
    clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', sprint: sprintDelta(res.result) };
};
