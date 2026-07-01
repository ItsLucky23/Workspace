//? Workspaces — [save-stage-config] typed per-action write route (Fase-0 split).
//? Persists the full editable per-stage config (`PipelineStageCfg`). The Conductor
//? reads the flat fields it recognizes + coerces the composite shapes. See quickAdd_v1.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import type { PipelineStageCfg } from '../_data/types';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueControlAction } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; stageId: string; cfg: PipelineStageCfg; clientRequestId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, stageId, cfg, clientRequestId } = data;
  if (!workspaceId || !stageId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.editPipeline);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const { signalSeq } = await enqueueControlAction({
    workspaceId, op: 'save-stage-config', target: { stageId },
    payload: { ...cfg },
    userId: user.id, clientRequestId,
  });
  return { status: 'success', result: { accepted: true, signalSeq } };
};
