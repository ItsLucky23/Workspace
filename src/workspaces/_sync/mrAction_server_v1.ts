//? Workspaces — [mr-*] REALTIME MR-review actions via `_sync` (BUILTIN_MR_REVIEW). One route for
//? the built-in merge-request surface — `action` selects the op (open/refresh, comment, approve,
//? merge, resolve) — each returns the fresh MR view (diff + threads + approvals) which the client
//? merges. `mr-create` is idempotent, so opening the MR tab uses it to load + refresh. Requires
//? workTickets.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import type { ControlOp } from '../_functions/controlApi';
import type { MrView } from '../../../server/mr/service';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: {
    clientRequestId: string; action: string; ticketKey: string;
    mrId?: string; body?: string; threadId?: string; filePath?: string; line?: number; side?: string; resolved?: boolean;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

const OP: Record<string, ControlOp> = {
  create: 'mr-create', comment: 'mr-comment', approve: 'mr-approve', merge: 'mr-merge', resolve: 'mr-resolve',
};

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { clientRequestId, action, ...payload } = clientInput;
  const op = OP[action];
  if (!op) return { status: 'error', errorCode: 'mr.badAction' };
  const res = await dispatchControlSync({
    op, roomCode, userId: user.id, prisma: functions.db.prisma, clientRequestId, payload,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', mr: (res.result ?? null) as MrView | null };
};
