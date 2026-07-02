//? Workspaces — [generate-docs] register-flow D: AI-author a project-summary doc from the
//? linked repo, persisted as a `generated` context-doc InfoSource (surfaces in Sources).
//? A direct `_api` op (NOT a Conductor control-op) because the AI turn is slow (~1-2min).
//? editPipeline-gated + rate-limited. The trigger button + live surfacing are a later UI slice.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { generateProjectDoc } from '../../../server/ai/docsGen';
import { hasCapability, CAP } from '../../../server/control/rbac';

export const rateLimit: number | false = 6;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const workspaceId = data.workspaceId;
  if (!workspaceId) return { status: 'error', errorCode: 'api.invalidRequest' };
  const allowed = await hasCapability(functions.db.prisma, workspaceId, user.id, CAP.editPipeline);
  if (!allowed) return { status: 'error', errorCode: 'auth.forbidden' };
  const result = await generateProjectDoc(functions.db.prisma, workspaceId);
  return { status: 'success', result };
};
