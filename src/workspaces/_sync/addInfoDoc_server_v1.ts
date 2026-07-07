//? Workspaces — [create-info-source] REALTIME write via `_sync` (FREEDOM_PROGRAM K2). Registers a
//? USER-UPLOADED doc (md/txt) as a context-doc InfoSource — the "bring your own knowledge" path that was a
//? dead `noop` on the Sources page. Returns the full doc list so every client replaces it (like scan-docs).
//? Requires editPipeline.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { docListDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { name: string; content: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { name, content, clientRequestId } = clientInput;
  const res = await dispatchControlSync({
    op: 'create-info-source', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { name, content }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', docs: docListDelta(res.result) };
};
