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

type UiReviewActionInput =
  | { op: 'ui-review-to-ticket'; reviewId: string; projectId: string; clientRequestId: string }
  | { op: 'ui-review-dismiss'; reviewId: string; clientRequestId: string };

export interface SyncParams {
  clientInput: UiReviewActionInput;
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, reviewId, clientRequestId } = clientInput;
  //? `validation = 'relaxed'` — the declared union is a contract, not a runtime guarantee, so the op
  //? is re-checked as a plain string before it is trusted.
  const opRaw: string = op;
  if ((opRaw !== 'ui-review-to-ticket' && opRaw !== 'ui-review-dismiss') || !reviewId) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const projectId = op === 'ui-review-to-ticket' ? clientInput.projectId : undefined;
  if (op === 'ui-review-to-ticket' && !projectId) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op, roomCode, userId: user.id, prisma: functions.db.prisma, clientRequestId,
    target: projectId ? { projectId } : {}, payload: { reviewId },
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
