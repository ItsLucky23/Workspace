//? Workspaces — [generate-docs] register-flow D: AI-author a project-summary doc from the
//? linked repo, persisted as a `generated` context-doc InfoSource (surfaces in Sources).
//? The AI turn runs outside the lease; its short deterministic InfoSource completion enters the Conductor.
//? editPipeline-gated + rate-limited. The trigger button + live surfacing are a later UI slice.

import { createHash } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { generateProjectDoc } from '../../../server/ai/docsGen';
import { hasCapability, CAP } from '../../../server/control/rbac';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';

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
  const result = await generateProjectDoc(functions.db.prisma, workspaceId, undefined, {
    persist: async (input) => {
      const digest = createHash('sha256').update(input.content).digest('hex');
      await enqueueInternalAction({
        workspaceId,
        op: 'project-docs-complete',
        target: {},
        payload: { content: input.content, summary: input.summary },
        userId: user.id,
        clientRequestId: `docs-complete:${digest}`,
      });
    },
  });
  return { status: 'success', result };
};
