//? Workspaces — [workspace-export] (H4) a tenant-scoped JSON export of the workspace's own data (portability /
//? backup / GDPR). Secrets are EXCLUDED — only env KEYS are listed. A read `_api` op, gated on `workspaceSettings`.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { buildWorkspaceExport } from '../../../server/export/workspaceExport';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 6;
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
  const bundle = await buildWorkspaceExport(functions.db.prisma, workspaceId, Date.now());
  if (!bundle) return { status: 'error', errorCode: 'export.notFound' };
  return { status: 'success', result: bundle };
};
