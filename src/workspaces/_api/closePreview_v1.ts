//? Workspaces — [close-preview] stop exposing a ticket's preview (remove its proxy route). Direct
//? `_api` op, gated on `workTickets`. The dev-server process stops with the container teardown.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { closePreviewForTicket } from '../../../server/container/previewSession';
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
  const result = await closePreviewForTicket(workspaceId, ticketKey);
  return { status: 'success', result };
};
