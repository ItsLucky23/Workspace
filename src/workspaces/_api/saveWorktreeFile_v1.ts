//? Workspaces — [save-worktree-file] SAVE an edited file back to a ticket's container worktree (#35, Track D).
//? The lightweight in-ticket editor was view-only; this persists an edit. The typed route gates/locks and
//? the Conductor performs the docker-exec STDIN write (content is never shell-interpolated). Gated on `workTickets` AND STAGE-LOCKED via
//? `ticketEditGuard` (the same C4 edit-lock the live editor uses): a save while the AI is mid-turn — or on a
//? non-user-editable stage — would race the agent's edits on the shared /work worktree, so it is refused.
/** @docs owner ItsLucky23 */

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { writeWorktreeFile } from '../../../server/container/worktreeFiles';
import { ticketEditGuard } from '../../../server/orchestrator/editGuard';
import { hasCapability, CAP } from '../../../server/control/rbac';
import { enqueueWorkspaceRouteWrite } from '../../../server/orchestrator/conductor';

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
  const result = await enqueueWorkspaceRouteWrite(
    workspaceId,
    { kind: 'worktree-file.save', userId: user.id },
    async () => {
      //? Re-check the stage lock INSIDE the writer lease; checking before enqueue left a race where an AI turn
      //? could start while this edit waited in the queue and both would then write `/work` concurrently.
      const guard = await ticketEditGuard(functions.db.prisma, workspaceId, ticketKey);
      if (!guard.allowed) return { ok: false, error: guard.reason ?? 'editor.locked' };
      return writeWorktreeFile(workspaceId, ticketKey, path, content);
    },
  );
  return { status: 'success', result };
};
