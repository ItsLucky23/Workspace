//? Workspaces — [open-editor] open the real per-ticket VS Code (openvscode-server in the
//? ticket container) for the current user and return the minted subdomain URL + connection
//? token (ADR 0010, CODE_EDITOR §1). A direct `_api` op (NOT a Conductor control-op) — the
//? container launch + openvscode boot are slow and must not block the serial writer, exactly
//? like generateDockerfile/buildProjectImage. Gated on `workTickets`. The user's profile
//? (extensions + auth) is projected into the session so logins follow them across tickets.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { openEditorForTicket } from '../../../server/container/editorSession';
import { ticketEditGuard } from '../../../server/orchestrator/editGuard';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 12;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; ticketKey: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, ticketKey } = data;
  if (!workspaceId || !ticketKey) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  //? Edit-lock (Track C4): refuse to open while the AI is mid-turn or the stage is not
  //? userEditable — opening then would race the agent's edits on the shared /work worktree.
  const guard = await ticketEditGuard(functions.db.prisma, workspaceId, ticketKey);
  if (!guard.allowed) return { status: 'success', result: { ok: false, error: guard.reason ?? 'editor.locked' } };
  //? The ticket must be activated (has a DEV-#### branch cut) before it has a container/editor.
  const ticket = await functions.db.prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { branch: true } });
  if (!ticket?.branch) return { status: 'error', errorCode: 'editor.notActivated' };
  //? Prefer the project's built L2 image (its toolchain); openvscode is installed on-demand if
  //? the image didn't bake it in.
  const project = await functions.db.prisma.project.findFirst({ where: { workspaceId }, select: { baseImageRef: true } });
  const result = await openEditorForTicket({
    workspaceId, ticketKey, branch: ticket.branch, userId: user.id,
    ...(project?.baseImageRef ? { image: project.baseImageRef } : {}),
  });
  return { status: 'success', result };
};
