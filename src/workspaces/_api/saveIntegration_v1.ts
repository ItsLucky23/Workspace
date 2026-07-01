//? Workspaces — [save-integration] typed per-action write route (Fase-0 split).
//? Creates or (when `integrationId` is given) updates an integration tool. The
//? `fields`/`mcp` composites are coerced Conductor-side. See quickAdd_v1 for the pattern.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import type { IntegrationTool } from '../_data/types';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueControlAction } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: {
    workspaceId: string;
    integrationId?: string;
    name: string;
    type: string;
    fields: IntegrationTool['fields'];
    mcp: IntegrationTool['mcp'];
    clientRequestId: string;
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, integrationId, name, type, fields, mcp, clientRequestId } = data;
  if (!workspaceId || name.trim().length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workspaceSettings);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const { signalSeq } = await enqueueControlAction({
    workspaceId, op: 'save-integration',
    target: integrationId ? { integrationId } : {},
    payload: { name, type, fields, mcp },
    userId: user.id, clientRequestId,
  });
  return { status: 'success', result: { accepted: true, signalSeq } };
};
