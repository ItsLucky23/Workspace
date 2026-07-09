//? Workspaces — [open-ref-preview] (T1) start the ticket's app at an ARBITRARY git ref (SHA/tag/branch) in an
//? ephemeral, ref-scoped container + expose it at a ref subdomain. A direct `_api` op (NOT a Conductor control-op)
//? — the container launch + dev-server boot are slow and must not block the serial writer, like openPreview.
//? Gated on `workTickets`.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { openRefPreview } from '../../../server/container/refPreview';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 12;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; ticketKey: string; ref: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, ticketKey, ref } = data;
  if (!workspaceId || !ticketKey || !ref) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const result = await openRefPreview(workspaceId, ticketKey, ref);
  return { status: 'success', result };
};
