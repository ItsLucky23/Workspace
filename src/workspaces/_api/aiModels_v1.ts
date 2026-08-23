//? Workspaces — [ai-models] (P4-4) the LIVE model list for one connected AI backend: `GET {baseUrl}/models`
//? through the connection's own key (tenant-scoped, never a client-supplied key), cached 10 min server-side,
//? `refresh: true` bypasses the cache. Feeds the add-form's model dropdown on the AI page; the static catalog
//? list is the client's fallback when this errors. Read-only — no Conductor op. Requires workspaceSettings.

/** @docs owner ItsLucky23 */
import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { listModelsForConnection } from '../../../server/ai/modelListing';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; connectionId: string; refresh?: boolean };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, connectionId, refresh } = data;
  if (!workspaceId || !connectionId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workspaceSettings);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const res = await listModelsForConnection(workspaceId, connectionId, refresh === true);
  if (!res.ok) return { status: 'error', errorCode: res.error ?? 'ai.modelsFailed' };
  return { status: 'success', result: { models: res.models, cached: res.cached } };
};
