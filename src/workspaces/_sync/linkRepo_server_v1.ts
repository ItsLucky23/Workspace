//? Workspaces — [link-repo] REALTIME write via `_sync` (register-flow step A). Clones
//? the given git repo into data/workspaces/<id>/ (bare) and broadcasts the resulting
//? repo status to the workspace room; every client shows the linked branch/head (or a
//? scrubbed error) with no refetch. Requires workspaceSettings (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { repoDelta } from '../../../server/read/mappers';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { projectId: string; gitUrl?: string; token?: string; disconnect?: boolean; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { projectId, gitUrl, token, disconnect, clientRequestId } = clientInput;
  const targetProjectId = projectId.trim();
  const targetGitUrl = gitUrl?.trim() ?? '';
  if (targetProjectId.length === 0 || (disconnect !== true && targetGitUrl.length === 0)) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'link-repo', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { projectId: targetProjectId, ...(disconnect === true ? { disconnect: true } : { gitUrl: targetGitUrl, ...(token ? { token } : {}) }) }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', repo: repoDelta(res.result) };
};
