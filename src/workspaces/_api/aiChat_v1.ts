//? Workspaces — [ai-chat] the Workspace-AI chat interpreter route. A member sends a
//? natural-language message; the server runs it through the pluggable AI-provider layer
//? and returns EITHER a plain reply OR a single PROPOSED control-op (validated against
//? the real workspace state) for the client to confirm. The AI never writes — an accepted
//? proposal is dispatched through the normal control-op routes, so execution stays under
//? the Conductor + OP_CAPABILITY RBAC. Membership-gated; heavily rate-limited (AI turns
//? are expensive). Per-user request/response (not a room broadcast), hence `_api` not `_sync`.

import { randomUUID } from 'node:crypto';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, ApiResponse } from '../../../src/_sockets/apiTypes.generated';
import { interpretChat } from '../../../server/ai/workspaceChat';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';
import { deterministicObjectId } from '../../../server/orchestrator/actionIds';

export const rateLimit: number | false = 20;
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';
export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

export interface ApiParams {
  data: { workspaceId: string; message: string; projectId?: string; history?: { role: string; text: string }[]; clientRequestId?: string };
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
  //? #112 — pass the client's recent conversation history so follow-ups keep context.
  const history = Array.isArray(data.history) ? data.history : undefined;
  const result = await interpretChat(functions.db.prisma, workspaceId, message, data.projectId, history, user.id);
  //? #111 — persist the turn (user message + AI reply text) so the chat survives reload / is
  //? cross-device. Proposals/plans are transient offers → not persisted (see the model doc).
  //? The expensive provider call completed OUTSIDE the workspace lease. Only its short deterministic
  //? completion write enters the Conductor, so AI latency cannot block unrelated authoritative actions.
  const suppliedRequestId = data.clientRequestId?.trim();
  const clientRequestId = suppliedRequestId !== undefined && suppliedRequestId.length > 0 ? suppliedRequestId : randomUUID();
  await enqueueInternalAction({
    workspaceId,
    op: 'chat-turn-record',
    target: {
      userMessageId: deterministicObjectId(workspaceId, `${user.id}:${clientRequestId}`, 'chat-user'),
      aiMessageId: deterministicObjectId(workspaceId, `${user.id}:${clientRequestId}`, 'chat-ai'),
    },
    payload: { userText: message, aiText: result.reply },
    userId: user.id,
    clientRequestId: `chat-turn:${clientRequestId}`,
  });
  return { status: 'success', result };
};
