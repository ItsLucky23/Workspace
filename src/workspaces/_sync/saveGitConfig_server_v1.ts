//? Workspaces — [save-git-config] REALTIME write via `_sync`. Persists the workspace's git
//? strategy + push policy (branchStrategy.ts GitConfig), then broadcasts the normalized config
//? back so every client replaces `snap.gitConfig` (no refetch). The Conductor normalizes +
//? writes it as a plain JSON blob on the Workspace. Requires workspaceSettings (OP_CAPABILITY).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import type { GitConfig } from '../_data/types';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { normalizeGitConfig } from '../../../server/git/branchStrategy';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { gitConfig: GitConfig; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { gitConfig, clientRequestId } = clientInput;
  const res = await dispatchControlSync({
    op: 'save-git-config', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { gitConfig }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success', gitConfig: normalizeGitConfig(res.result) };
};
