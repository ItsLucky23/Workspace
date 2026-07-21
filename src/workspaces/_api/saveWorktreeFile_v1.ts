//? Workspaces — [save-worktree-file] SAVE an edited file back to a ticket's container worktree (#35, Track D).
//? The lightweight in-ticket editor was view-only; this persists an edit. The typed route gates/locks and
//? the Conductor performs the docker-exec STDIN write (content is never shell-interpolated). Gated on `workTickets` AND STAGE-LOCKED via
//? `ticketEditGuard` (the same C4 edit-lock the live editor uses): a save while the AI is mid-turn — or on a
//? non-user-editable stage — would race the agent's edits on the shared /work worktree, so it is refused.
/** @docs owner ItsLucky23 */

import { createHash } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { hasCapability, CAP } from '../../../server/control/rbac';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; ticketKey: string; path: string; content: string; clientRequestId?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, ticketKey, path } = data;
  const content = typeof data.content === 'string' ? data.content : '';
  if (!workspaceId || !ticketKey || !path) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const suppliedRequestId = data.clientRequestId?.trim();
  const requestId = suppliedRequestId !== undefined && suppliedRequestId.length > 0 ? suppliedRequestId : createHash('sha256').update(ticketKey).update('\0').update(path).update('\0').update(content).digest('hex');
  const applied = await enqueueInternalAction({
    workspaceId,
    op: 'worktree-file-save',
    target: { ticketKey },
    payload: { path, content },
    userId: user.id,
    clientRequestId: `worktree-file-save:${requestId}`,
  });
  const result = applied.result !== null && typeof applied.result === 'object' && 'ok' in applied.result && typeof applied.result.ok === 'boolean'
    ? { ok: applied.result.ok, ...('error' in applied.result && typeof applied.result.error === 'string' ? { error: applied.result.error } : {}) }
    : { ok: false, error: 'editor.writeFailed' };
  return { status: 'success', result };
};
