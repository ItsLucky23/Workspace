//? Workspaces — [remove-integration] REALTIME write via `_sync`. Deletes an
//? integration tool, then broadcasts the removed id to the workspace room; every
//? client drops it (no refetch). Requires workspaceSettings.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { integrationId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const res = await dispatchControlSync({
    op: 'remove-integration', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { integrationId: clientInput.integrationId }, clientRequestId: clientInput.clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', removedIntegrationId: clientInput.integrationId };
};
