//? Workspaces — save one project's runtime commands/settings. The `_api` route is only the typed,
//? workspaceSettings-gated control edge; the Conductor performs the exact workspace+project write.
//? Empty commands clear their override and fall back to package.json scripts.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { dispatchControlSync } from '../../../server/control/dispatchSync';

export const rateLimit: number | false = 30;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  //? D1/E1/E2 — also set the prod serve command, the stack (any-stack base), and the expert custom-base opt-in.
  data: { workspaceId: string; projectId: string; clientRequestId: string; devCommand: string; prodCommand?: string; stack?: string; allowCustomBase?: boolean };
  user: SessionLayout;
  functions: Functions;
}

const STACKS = new Set(['node', 'python', 'go', 'rust', 'java', 'php', 'dotnet', 'ruby', 'generic']);

export async function saveDevCommand(data: ApiParams['data'], userId: string, prisma: Functions['db']['prisma']): Promise<ApiResponse> {
  const { workspaceId, projectId, clientRequestId, devCommand } = data;
  if (!workspaceId || !projectId || !clientRequestId || typeof devCommand !== 'string') return { status: 'error', errorCode: 'api.invalidRequest' };
  const stack = typeof data.stack === 'string' && STACKS.has(data.stack) ? data.stack : undefined;
  const dispatched = await dispatchControlSync({
    op: 'project-runtime-save', roomCode: workspaceId, userId, prisma, clientRequestId,
    target: { projectId },
    payload: {
      devCommand,
      ...(data.prodCommand === undefined ? {} : { prodCommand: data.prodCommand }),
      ...(stack ? { stack } : {}),
      ...(typeof data.allowCustomBase === 'boolean' ? { allowCustomBase: data.allowCustomBase } : {}),
    },
  });
  if (!dispatched.ok) {
    return { status: 'error', errorCode: dispatched.errorCode === 'auth.forbidden' ? 'auth.forbidden' : 'api.invalidRequest' };
  }
  return { status: 'success', result: { ok: true } };
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> =>
  saveDevCommand(data, user.id, functions.db.prisma);
