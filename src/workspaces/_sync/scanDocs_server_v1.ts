//? Workspaces — [scan-docs] REALTIME write via `_sync` (docs-init scan). Scans the
//? linked repo for doc files and registers each as a context-doc InfoSource, then
//? broadcasts the full doc list to the workspace room; every client replaces its docs
//? (no refetch). Each doc's aiEditable gate defaults OFF. Requires editPipeline.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { docListDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const res = await dispatchControlSync({
    op: 'scan-docs', roomCode, userId: user.id, prisma: functions.db.prisma,
    clientRequestId: clientInput.clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', docs: docListDelta(res.result) };
};
