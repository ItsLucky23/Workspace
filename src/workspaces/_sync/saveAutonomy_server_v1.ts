//? Workspaces — [save-autonomy] REALTIME write via `_sync` (FREEDOM_PROGRAM A4). Persists the workspace's
//? autonomy level (how often the human is asked to approve a stage), then broadcasts the stored level back so
//? every client replaces the active workspace's `autonomyLevel`. The Conductor is the single writer. Requires
//? workspaceSettings capability (enforced by the control-op RBAC).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

const LEVELS = new Set(['gate-every', 'gate-key-stages', 'full-auto']);

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { autonomyLevel: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { autonomyLevel, clientRequestId } = clientInput;
  const res = await dispatchControlSync({
    op: 'save-autonomy', roomCode, userId: user.id, prisma: functions.db.prisma,
    payload: { autonomyLevel }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  //? Mirror the Conductor's validation for the broadcast (avoids narrowing the untyped control-op result).
  return { status: 'success', autonomyLevel: LEVELS.has(autonomyLevel) ? autonomyLevel : 'gate-key-stages' };
};
