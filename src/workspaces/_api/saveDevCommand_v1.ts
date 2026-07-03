//? Workspaces — [save-dev-command] set the project's `devCommand` (the command that starts the
//? app's dev server in the ticket container for the preview flow, ADR 0011/Track P4). A direct
//? `_api` write, workspaceSettings-gated. Empty clears it (falls back to package.json scripts.dev).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; devCommand: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, devCommand } = data;
  if (!workspaceId || typeof devCommand !== 'string') return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workspaceSettings);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const trimmed = devCommand.trim();
  await functions.db.prisma.project.updateMany({ where: { workspaceId }, data: { devCommand: trimmed.length > 0 ? trimmed : null } });
  return { status: 'success', result: { ok: true } };
};
