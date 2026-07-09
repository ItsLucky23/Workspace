//? Workspaces — [knowledge-graph] (N1) the Obsidian-view data: the workspace knowledge as nodes (sources /
//? tickets / content pieces) + similarity + link edges. A direct read `_api` op (the embed pass is CPU-ish, not
//? an authoritative write). Gated on `workTickets`. Tenant-scoped.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { buildKnowledgeGraph } from '../../../server/rag/graph';
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
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const graph = await buildKnowledgeGraph(functions.db.prisma, workspaceId);
  return { status: 'success', result: graph };
};
