//? Workspaces — [output-template] ops via `_sync` (FREEDOM_PROGRAM O5). Create/update/delete a reusable output
//? spec (a named render format + watermark position). Single-writer Conductor + control-op RBAC (workTickets).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

type OutputTemplateOp = 'save-output-template' | 'delete-output-template';

export interface SyncParams {
  clientInput: { op: OutputTemplateOp; templateId?: string; name?: string; format?: string; watermarkPosition?: string; clientRequestId: string };
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
