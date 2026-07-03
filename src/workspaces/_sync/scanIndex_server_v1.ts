//? Workspaces — [scan-index] REALTIME write via `_sync` (RAG code index, 07 §D). Reads the linked
//? repo's code, chunks + embeds it, and upserts the RagEntry store, then broadcasts the index result
//? (files/chunks/commit/embedder) to the workspace room so every client shows the fresh status.
//? Requires editPipeline.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

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
    op: 'scan-index', roomCode, userId: user.id, prisma: functions.db.prisma,
    clientRequestId: clientInput.clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  const r = (res.result ?? {}) as Record<string, unknown>;
  return {
    status: 'success',
    ragIndex: {
      ok: r.ok === true,
      files: typeof r.files === 'number' ? r.files : 0,
      chunks: typeof r.chunks === 'number' ? r.chunks : 0,
      commitHash: typeof r.commitHash === 'string' ? r.commitHash : '',
      embedder: typeof r.embedder === 'string' ? r.embedder : '',
    },
  };
};
