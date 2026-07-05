//? Workspaces — ticket ↔ artifact link writes via `_sync` (ADR 0034). Two control-ops through the
//? single-writer Conductor (B-23), RBAC-gated (workTickets): `ticket-link-artifact` links a
//? design/Studio artifact to a ticket (injected at stage-spawn), `ticket-unlink-artifact` removes it.
//? Links change rarely → the client refetches the snapshot after the write.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { op: string; clientRequestId: string; ticketId?: string; linkId?: string; artifactId?: string; artifactKind?: string; label?: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, clientRequestId, ticketId, linkId, ...payload } = clientInput;
  if (op !== 'ticket-link-artifact' && op !== 'ticket-unlink-artifact') return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op, roomCode, userId: user.id, prisma: functions.db.prisma, clientRequestId,
    target: { ...(ticketId ? { ticketId } : {}), ...(linkId ? { linkId } : {}) }, payload,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
