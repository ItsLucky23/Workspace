//? Workspaces — [create-workspace] typed per-action route (Fase-0 split). Login-only
//? (the caller becomes Owner) and CREATES the tenant, so it can't be scoped/enqueued
//? by workspaceId — it's a direct RBAC-gated bootstrap write. Uses `createBlankWorkspace`
//? (Project + default pipeline + light starter seed) and returns the new id.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { createBlankWorkspace } from '../../../server/bootstrap/seedWorkspace';

export const rateLimit: number | false = 10;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { name: string; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const name = data.name.trim();
  if (name.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  const { workspaceId } = await createBlankWorkspace(functions.db.prisma, user.id, name);
  return { status: 'success', result: { accepted: true, signalSeq: 0, workspaceId } };
};
