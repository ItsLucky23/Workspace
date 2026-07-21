//? Workspaces Studio — create or update a product/marketing BRIEF. Membership-gated; the brief is
//? authoritative workspace content, so the typed `_api` validates and the Conductor performs the write.
//? `relaxed` validation: the handler validates every field explicitly below.

import { randomUUID } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';
import { deterministicObjectId } from '../../../server/orchestrator/actionIds';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  //? Fields are optional at the type level because the route is `validation: 'relaxed'` (the handler
  //? validates below) — so the `?? ''` guards are genuine, not dead conditionals.
  data: { workspaceId: string; id?: string; projectId?: string; name?: string; productName?: string; audience?: string; tone?: string; goals?: string; notes?: string; clientRequestId?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId } = data;
  if (!workspaceId) return { status: 'error', errorCode: 'api.invalidRequest' };
  if (!(await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.workTickets))) return { status: 'error', errorCode: 'auth.forbidden' };

  const name = (data.name ?? '').trim();
  const productName = (data.productName ?? '').trim();
  if (name.length === 0 || productName.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  const projectId = (data.projectId ?? '').trim();
  if (projectId) {
    const project = await functions.db.prisma.project.findFirst({ where: { workspaceId, id: projectId }, select: { id: true } });
    if (!project) return { status: 'error', errorCode: 'api.invalidRequest' };
  }
  const fields = {
    name, productName,
    audience: (data.audience ?? '').trim(),
    tone: (data.tone ?? '').trim(),
    goals: (data.goals ?? '').trim(),
    notes: (data.notes ?? '').trim() || null,
    //? Optional per-project scope (#169): only set when provided, so an unscoped brief stays unscoped.
    ...(projectId ? { projectId } : {}),
  };

  const create = !data.id;
  const suppliedRequestId = data.clientRequestId?.trim();
  const requestId = suppliedRequestId !== undefined && suppliedRequestId.length > 0 ? suppliedRequestId : randomUUID();
  const briefId = data.id ?? deterministicObjectId(workspaceId, requestId, 'studio-brief');
  const saved = await enqueueInternalAction({
    workspaceId,
    op: 'studio-brief-save',
    target: { briefId },
    payload: { create, ...fields },
    userId: user.id,
    clientRequestId: `studio-brief-save:${requestId}`,
  });
  const savedId = saved.result !== null && typeof saved.result === 'object' && 'keys' in saved.result && Array.isArray(saved.result.keys)
    ? saved.result.keys.find((key): key is string => typeof key === 'string')
    : undefined;
  return savedId ? { status: 'success', result: { id: savedId } } : { status: 'error', errorCode: 'api.invalidRequest' };
};
