//? Workspaces — [ui-review-to-ticket / ui-review-dismiss] (U2 gap-fix) act on an open "unfuck the UI"
//? review request: turn it into a redesign ticket (problems + notes + screenshots become the ticket
//? description) or dismiss it. Both dispatch through the single-writer Conductor (B-23), RBAC-gated
//? (workTickets). The client refetches the snapshot for the updated inbox + board.

/** @docs owner ItsLucky23 */
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { op: string; reviewId: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, reviewId, clientRequestId } = clientInput;
  if ((op !== 'ui-review-to-ticket' && op !== 'ui-review-dismiss') || !reviewId) {
    return { status: 'error', errorCode: 'sync.invalidRequest' };
  }
  const res = await dispatchControlSync({
    op, roomCode, userId: user.id, prisma: functions.db.prisma, clientRequestId,
    payload: { reviewId },
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
