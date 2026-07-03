//? Workspaces — [open-preview] start the ticket's app dev-server in its container + expose it at
//? the preview subdomain, returning the URL (P4). A direct `_api` op (NOT a Conductor control-op)
//? — the container launch + dev-server boot are slow and must not block the serial writer, like
//? openEditor/generateDockerfile. Gated on `workTickets`.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { openPreviewForTicket } from '../../../server/container/previewSession';
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
  const result = await openPreviewForTicket(workspaceId, ticketKey);
  return { status: 'success', result };
};
