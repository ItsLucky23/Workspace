//? Workspaces Studio — create or update a product/marketing BRIEF. Membership-gated; the brief is
//? authoritative workspace content, so the typed `_api` validates and the Conductor performs the write.
//? `relaxed` validation: the handler validates every field explicitly below.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { enqueueWorkspaceRouteWrite } from '../../../server/orchestrator/conductor';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  //? Fields are optional at the type level because the route is `validation: 'relaxed'` (the handler
  //? validates below) — so the `?? ''` guards are genuine, not dead conditionals.
  data: { workspaceId: string; id?: string; projectId?: string; name?: string; productName?: string; audience?: string; tone?: string; goals?: string; notes?: string };
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

  const id = data.id;
  const savedId = await enqueueWorkspaceRouteWrite(
    workspaceId,
    { kind: 'studio-brief.save', userId: user.id },
    async () => {
      if (id) {
        const updated = await functions.db.prisma.studioBrief.updateMany({ where: { workspaceId, id }, data: fields });
        return updated.count === 1 ? id : null;
      }
      const brief = await functions.db.prisma.studioBrief.create({ data: { workspaceId, ...fields } });
      return brief.id;
    },
  );
  return savedId ? { status: 'success', result: { id: savedId } } : { status: 'error', errorCode: 'api.invalidRequest' };
};
