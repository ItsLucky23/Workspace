//? Workspaces Studio — create or update a product/marketing BRIEF. Membership-gated; the brief is
//? plain content (no orchestration state), so it writes via `_api` like the chat/preferences routes.
//? `relaxed` validation: the handler validates every field explicitly below.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';

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
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };

  const name = (data.name ?? '').trim();
  const productName = (data.productName ?? '').trim();
  if (name.length === 0 || productName.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  const projectId = (data.projectId ?? '').trim();
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
  const brief = id
    ? await functions.db.prisma.studioBrief.update({ where: { id }, data: fields }).catch(() => null)
    : await functions.db.prisma.studioBrief.create({ data: { workspaceId, ...fields } });
  if (!brief) return { status: 'error', errorCode: 'common.500' };
  return { status: 'success', result: { id: brief.id } };
};
