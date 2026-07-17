/** @docs owner ItsLucky23 */
//? Workspaces — [comment-inbox] the read-only comment inbox writes via `_sync` (CI,
//? DOCUMENTS_AND_SKILLS). Two ops: comments-refresh (on-demand fetch of the published posts'
//? comments) + comments-mark-read (one or all). Dispatched through the single-writer Conductor
//? (B-23), RBAC-gated (workTickets) via OP_CAPABILITY. Replies are a deliberate non-goal.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';
import { broadcastContentDirty } from '../../../server/read/broadcast';
import type { ControlOp } from '../_functions/controlApi';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

const COMMENT_OPS = new Set<string>(['comments-refresh', 'comments-mark-read']);
const isCommentOp = (op: string): op is ControlOp => COMMENT_OPS.has(op);

export interface SyncParams {
  clientInput: { op: string; clientRequestId: string; commentId?: string };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, clientRequestId, ...payload } = clientInput;
  if (!isCommentOp(op)) return { status: 'error', errorCode: 'sync.invalidRequest' };
  const res = await dispatchControlSync({ op, roomCode, userId: user.id, prisma: functions.db.prisma, clientRequestId, payload });
  if (!res.ok) return { status: 'error', errorCode: res.errorCode };
  broadcastContentDirty(roomCode);
  return { status: 'success' };
};
