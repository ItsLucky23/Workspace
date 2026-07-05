//? Workspaces Designer — AI generation of a STYLE or an ANIMATION from a plain-language brief (the
//? "AI adjusts everything" flow). Returns the raw generated object; the client coerces it into a valid
//? DesignStyle / AnimSpec. Membership-gated; `relaxed` (the handler validates below).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { generateStyle, generateAnimation } from '../../../server/designer/generateAsset';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; kind: string; prompt: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, kind, prompt } = data;
  if (!workspaceId || (kind !== 'style' && kind !== 'animation') || typeof prompt !== 'string' || prompt.trim().length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };

  const result = kind === 'style' ? await generateStyle(prompt.trim(), workspaceId) : await generateAnimation(prompt.trim(), workspaceId);
  if (!result) return { status: 'error', errorCode: 'designer.generateFailed' };
  return { status: 'success', result: { asset: result } };
};
