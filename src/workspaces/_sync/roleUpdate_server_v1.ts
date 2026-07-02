//? Workspaces — [role-update] REALTIME write via `_sync`. Updates a role's label /
//? perms, then broadcasts it to the workspace room; every client upserts it by key
//? (no refetch). Requires editPipeline (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { roleDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { roleKey: string; label?: string; perms?: boolean[]; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { roleKey, label, perms, clientRequestId } = clientInput;
  if (!roleKey) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'role-update', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { roleKey }, payload: { ...(label ? { label } : {}), ...(perms ? { perms } : {}) }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', role: roleDelta(res.result) };
};
