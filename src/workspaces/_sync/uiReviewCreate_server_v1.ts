//? Workspaces — [ui-review-create] (U1) persist a "unfuck the UI" review request: uploaded screenshots + ticked
//? problems (taxonomy) + free-text. The Conductor sanitizes + persists (B-23). Requires workTickets (it leads to
//? a redesign ticket). U2 turns an accepted request into redesign variants → a ticket.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface SyncParams {
  clientInput: { projectId: string; screenshots: string[]; problems: string[]; page?: string; notes?: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { projectId, screenshots, problems, page, notes, clientRequestId } = clientInput;
  const hasContent = (Array.isArray(screenshots) && screenshots.length > 0) || (Array.isArray(problems) && problems.length > 0);
  if (!projectId || !hasContent) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({
    op: 'ui-review-create', roomCode, userId: user.id, prisma: functions.db.prisma,
    target: { projectId }, payload: { screenshots, problems, ...(page ? { page } : {}), ...(notes ? { notes } : {}) }, clientRequestId,
  });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  return { status: 'success' };
};
