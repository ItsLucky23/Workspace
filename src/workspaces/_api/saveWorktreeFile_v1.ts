//? Workspaces — [save-worktree-file] SAVE an edited file back to a ticket's container worktree (#35, Track D).
//? The lightweight in-ticket editor was view-only; this persists an edit. A direct `_api` op (docker exec
//? through STDIN — content is never shell-interpolated). Gated on `workTickets` AND STAGE-LOCKED via
//? `ticketEditGuard` (the same C4 edit-lock the live editor uses): a save while the AI is mid-turn — or on a
//? non-user-editable stage — would race the agent's edits on the shared /work worktree, so it is refused.
//?
//? @docs owner ItsLucky23

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { writeWorktreeFile } from '../../../server/container/worktreeFiles';
import { ticketEditGuard } from '../../../server/orchestrator/editGuard';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; ticketKey: string; path: string; content: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, ticketKey, path } = data;
  const content = typeof data.content === 'string' ? data.content : '';
  if (!workspaceId || !ticketKey || !path) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  //? Stage-lock (C4): never write while the agent is mid-turn or the stage isn't user-editable.
  const guard = await ticketEditGuard(functions.db.prisma, workspaceId, ticketKey);
  if (!guard.allowed) return { status: 'success', result: { ok: false, error: guard.reason ?? 'editor.locked' } };
  const result = await writeWorktreeFile(workspaceId, ticketKey, path, content);
  return { status: 'success', result };
};
