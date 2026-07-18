//? Workspaces — [trigger-*] automation-trigger writes via `_sync` (#2). One route for the three
//? trigger control-ops (save/toggle/delete), each dispatched through the single-writer Conductor
//? (RBAC-gated per op: editPipeline). Automation config is workspace-level, so the client refetches
//? the snapshot after the write (triggers change rarely — no per-field delta needed).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: {
    op: string; clientRequestId: string;
    id?: string; triggerId?: string; name?: string; on?: string; action?: string; role?: string; focus?: string; projectId?: string;
    params?: unknown; match?: unknown; requiresApproval?: boolean; cron?: string; enabled?: boolean; dedupeKey?: string; debounceMs?: number;
  };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, clientRequestId, triggerId, ...payload } = clientInput;
  if (op !== 'trigger-save' && op !== 'trigger-toggle' && op !== 'trigger-delete' && op !== 'trigger-run' && op !== 'run-agent-role') {
    return { status: 'error', errorCode: 'sync.invalidRequest' };
  }
  const res = await dispatchControlSync({
    op, roomCode, userId: user.id, prisma: functions.db.prisma, clientRequestId,
    ...(triggerId ? { target: { triggerId } } : {}), payload,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
