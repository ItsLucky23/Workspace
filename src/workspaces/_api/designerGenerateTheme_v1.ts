//? Workspaces Designer — AI theme generation. Takes a plain-language brief and returns a full
//? light+dark set of the 30 `--color-*` design tokens (via the pluggable AI-provider layer,
//? feature `designer-theme`). Stateless: the client adds the returned token-set to its theme
//? library. Membership-gated; `relaxed` (the handler validates below).

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { generateTheme } from '../../../server/designer/generateTheme';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; prompt: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const { workspaceId, prompt } = data;
  if (!workspaceId || typeof prompt !== 'string' || prompt.trim().length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };

  const theme = await generateTheme(prompt.trim(), workspaceId);
  if (!theme) return { status: 'error', errorCode: 'designer.generateFailed' };
  return { status: 'success', result: { name: theme.name, description: theme.description, light: theme.light, dark: theme.dark } };
};
