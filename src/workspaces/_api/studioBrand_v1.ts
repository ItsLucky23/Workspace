//? Workspaces Studio — the central brand library (ADR 0013 G-MKT-2). `op:'save'` upserts the
//? workspace brand (palette/typography/voice/taglines/logos); `op:'promote'` adopts a generated
//? `brand` artifact into the library. Membership-gated; `relaxed` (handler validates below).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { saveBrandLibrary, promoteArtifactToBrand } from '../../../server/studio/brand';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: {
    workspaceId: string; op: string; artifactId?: string;
    name?: string; palette?: { name: string; hex: string }[]; typography?: { heading: string; body: string };
    voice?: string; taglines?: string[]; logoIdeas?: string[];
  };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, op } = data;
  if (!workspaceId || (op !== 'save' && op !== 'promote')) return { status: 'error', errorCode: 'api.invalidRequest' };
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };

  if (op === 'promote') {
    if (!data.artifactId) return { status: 'error', errorCode: 'api.invalidRequest' };
    const ok = await promoteArtifactToBrand(functions.db.prisma, workspaceId, data.artifactId);
    return ok ? { status: 'success', result: { ok } } : { status: 'error', errorCode: 'studio.notABrand' };
  }
  await saveBrandLibrary(functions.db.prisma, workspaceId, {
    ...(data.name === undefined ? {} : { name: data.name }),
    ...(data.palette === undefined ? {} : { palette: data.palette }),
    ...(data.typography === undefined ? {} : { typography: data.typography }),
    ...(data.voice === undefined ? {} : { voice: data.voice }),
    ...(data.taglines === undefined ? {} : { taglines: data.taglines }),
    ...(data.logoIdeas === undefined ? {} : { logoIdeas: data.logoIdeas }),
  });
  return { status: 'success', result: { ok: true } };
};
