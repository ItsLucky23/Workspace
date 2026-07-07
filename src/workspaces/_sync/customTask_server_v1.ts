//? Workspaces — [custom-task] ops via `_sync` (FREEDOM_PROGRAM E5). Create/update/delete a user-defined AI
//? task + run one. All go through the single-writer Conductor + the control-op RBAC (workTickets). Running a
//? task is propose/generate — it stores the task's `lastOutput` only, never authoritative state.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

type CustomTaskOp = 'save-custom-task' | 'delete-custom-task' | 'run-custom-task';

export interface SyncParams {
  clientInput: { op: CustomTaskOp; taskId?: string; name?: string; promptTemplate?: string; vars?: Record<string, string>; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, clientRequestId, ...payload } = clientInput;
  const res = await dispatchControlSync({ op, roomCode, userId: user.id, prisma: functions.db.prisma, payload, clientRequestId });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
