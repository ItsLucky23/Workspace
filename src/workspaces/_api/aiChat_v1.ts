//? Workspaces — [ai-chat] the Workspace-AI chat interpreter route. A member sends a
//? natural-language message; the server runs it through the pluggable AI-provider layer
//? and returns EITHER a plain reply OR a single PROPOSED control-op (validated against
//? the real workspace state) for the client to confirm. The AI never writes — an accepted
//? proposal is dispatched through the normal control-op routes, so execution stays under
//? the Conductor + OP_CAPABILITY RBAC. Membership-gated; heavily rate-limited (AI turns
//? are expensive). Per-user request/response (not a room broadcast), hence `_api` not `_sync`.

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { interpretChat } from '../../../server/ai/workspaceChat';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; message: string; projectId?: string };
  user: SessionLayout;
  functions: Functions;
}

export const main = async ({ data, user, functions }: ApiParams): Promise<ApiResponse> => {
  const workspaceId = data.workspaceId;
  const message = data.message.trim();
  if (!workspaceId || message.length === 0) return { status: 'error', errorCode: 'api.invalidRequest' };
  //? Membership gate — the AI must never expose one workspace's state to a non-member.
  const member = await functions.db.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } });
  if (!member) return { status: 'error', errorCode: 'auth.forbidden' };
  //? R3-b — thread the caller's active project so the code-RAG grounds on the right repo (resolver validates it).
  const result = await interpretChat(functions.db.prisma, workspaceId, message, data.projectId);
  return { status: 'success', result };
};
