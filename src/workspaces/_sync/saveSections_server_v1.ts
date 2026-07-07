//? Workspaces — [save-sections] REALTIME write via `_sync`. Persists the workspace's enabled
//? nav-section set (module gating, _data/modules.ts), then broadcasts the sanitized list back so
//? every client replaces the active workspace's `enabledSections` (no refetch). The Conductor is
//? the single writer. Requires workspaceSettings capability (enforced by the control-op RBAC).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { sanitizeSections } from '../_data/modules';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { enabledSections: string[]; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { enabledSections, clientRequestId } = clientInput;
  const res = await dispatchControlSync({
    op: 'save-sections', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { enabledSections }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  //? Re-sanitize the input for the broadcast — pure + identical to what the Conductor stored
  //? (avoids narrowing the untyped control-op result).
  return { status: 'success', enabledSections: sanitizeSections(enabledSections) };
};
