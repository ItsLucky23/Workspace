/** @docs owner ItsLucky23 */
//? Workspaces — [clone-workspace] (GAP_SCAN G2). Duplicates THIS workspace's configuration (pipeline,
//? skills, styles, references, channels, triggers, custom tasks, non-secret env) into a NEW workspace
//? owned by the caller, through the single-writer Conductor (B-23), RBAC-gated to workspaceSettings.
//? Deliberately copies no tickets, no content, no credentials and no members — see
//? `server/bootstrap/cloneWorkspace.ts` for the full contract. The client refetches: the new workspace
//? appears in the switcher.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { name: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { name, clientRequestId } = clientInput;
  if (typeof name !== 'string' || name.trim().length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'clone-workspace', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { name: name.trim() }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
