//? Workspaces — Interviewer finding writes via `_sync` (ADR 0034). Two control-ops dispatched through
//? the single-writer Conductor (B-23), RBAC-gated (workTickets): `finding-to-ticket` (create a ticket
//? from a finding — human-initiated, the Interviewer never creates tickets itself) and
//? `finding-dismiss`. Findings change rarely → the client refetches the snapshot after the write.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { op: string; clientRequestId: string; findingId?: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, clientRequestId, findingId } = clientInput;
  if (op !== 'finding-to-ticket' && op !== 'finding-dismiss') return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op, roomCode, userId: user.id, prisma: functions.db.prisma, clientRequestId,
    ...(findingId ? { target: { findingId } } : {}), payload: {},
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
