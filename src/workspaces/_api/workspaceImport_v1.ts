//? Workspaces — [workspace-import] (gap-fix) the missing counterpart of workspace-export: bring a
//? previously-exported JSON bundle back as a NEW workspace owned by the caller (tickets re-sequenced,
//? sources + content-piece titles recreated; no members/secrets — the bundle never carried them).
//? Login-only (creating your own new workspace, like createWorkspace).

/** @docs owner ItsLucky23 */
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { importWorkspaceBundle } from '../../../server/export/workspaceImport';

export const rateLimit: number | false = 3;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { bundle: unknown };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const res = await importWorkspaceBundle(functions.db.prisma, user.id, data.bundle);
  if (!res.ok) return { status: 'error', errorCode: res.error ?? 'import.failed' };
  return { status: 'success', result: res };
};
