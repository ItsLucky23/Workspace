//? Workspaces — [copy-workspace-assets] via `_sync` (FREEDOM_PROGRAM R2). Copy the user-authored styles + the
//? brand kit from a source workspace INTO the active one. Single-writer Conductor + control-op RBAC
//? (workspaceSettings); the Conductor also authorizes the SOURCE membership before copying.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { sourceWorkspaceId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { sourceWorkspaceId, clientRequestId } = clientInput;
  const res = await dispatchControlSync({ op: 'copy-workspace-assets', roomCode, userId: user.id, prisma: functions.db.prisma, payload: { sourceWorkspaceId }, clientRequestId });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
