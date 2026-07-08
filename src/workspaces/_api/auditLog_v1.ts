//? Workspaces — [audit-log] (H1) the admin/security audit view: recent governance entries (who did what, when)
//? newest-first with actor names. A read `_api` op. Gated on `workspaceSettings` (admin-level). Tenant-scoped.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { listAuditLog } from '../../../server/control/audit';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 12;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId } = data;
  if (!workspaceId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workspaceSettings);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const entries = await listAuditLog(functions.db.prisma, workspaceId);
  return { status: 'success', result: { entries } };
};
